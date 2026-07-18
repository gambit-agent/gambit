import type { Node } from 'acorn'
import { parse } from 'acorn'

import type { WorkflowMeta, WorkflowMetaPhase } from './workflow-types'

type AnyNode = Node & { [key: string]: any; start: number; end: number }

const NONDETERMINISM_ERROR =
  'Workflow scripts must be deterministic: Date.now(), Math.random(), and new Date() are unavailable'

export function parseWorkflowScript(script: string): { meta: WorkflowMeta; body: string } {
  const ast = parse(script, {
    ecmaVersion: 'latest',
    sourceType: 'module',
    allowAwaitOutsideFunction: true,
    allowReturnOutsideFunction: true,
    ranges: false,
  }) as AnyNode

  assertDeterministicAst(ast)

  const first = ast.body?.[0] as AnyNode | undefined
  if (first?.type !== 'ExportNamedDeclaration') {
    throw new Error('`export const meta = { name, description }` must be the first statement in the script')
  }

  const declaration = first.declaration as AnyNode | null
  if (declaration?.type !== 'VariableDeclaration' || declaration.kind !== 'const') {
    throw new Error('meta export must be `export const meta = ...`')
  }
  if (declaration.declarations.length !== 1) {
    throw new Error('meta export must declare only `meta`')
  }

  const declarator = declaration.declarations[0] as AnyNode
  if (declarator.id?.type !== 'Identifier' || declarator.id.name !== 'meta') {
    throw new Error('meta export must declare `meta`')
  }
  if (!declarator.init) {
    throw new Error('meta must have a literal value')
  }

  const meta = evaluateLiteral(declarator.init, 'meta')
  validateMeta(meta)

  return {
    meta,
    body: script.slice(0, first.start) + script.slice(first.end),
  }
}

function evaluateLiteral(node: AnyNode, path: string): unknown {
  switch (node.type) {
    case 'ObjectExpression': {
      const out: Record<string, unknown> = {}
      for (const prop of node.properties as AnyNode[]) {
        if (prop.type === 'SpreadElement') {
          throw new Error(`spread not allowed in ${path}`)
        }
        if (prop.type !== 'Property') {
          throw new Error(`only plain properties allowed in ${path}`)
        }
        if (prop.computed) {
          throw new Error(`computed keys not allowed in ${path}`)
        }
        if (prop.kind !== 'init' || prop.method) {
          throw new Error(`methods/accessors not allowed in ${path}`)
        }
        const key = propertyKey(prop.key as AnyNode, path)
        if (key === '__proto__' || key === 'constructor' || key === 'prototype') {
          throw new Error(`reserved key name not allowed in ${path}: ${key}`)
        }
        out[key] = evaluateLiteral(prop.value as AnyNode, `${path}.${key}`)
      }
      return out
    }
    case 'ArrayExpression':
      return (node.elements as Array<AnyNode | null>).map((element, index) => {
        if (!element) {
          throw new Error(`sparse arrays not allowed in ${path}`)
        }
        if (element.type === 'SpreadElement') {
          throw new Error(`spread not allowed in ${path}`)
        }
        return evaluateLiteral(element, `${path}[${index}]`)
      })
    case 'Literal':
      return node.value
    case 'TemplateLiteral':
      if (node.expressions.length > 0) {
        throw new Error(`template interpolation not allowed in ${path}`)
      }
      return node.quasis.map((quasi: AnyNode) => quasi.value.cooked ?? quasi.value.raw).join('')
    case 'UnaryExpression':
      if (node.operator === '-' && node.argument?.type === 'Literal' && typeof node.argument.value === 'number') {
        return -node.argument.value
      }
      throw new Error(`only negative-number unary allowed in ${path}`)
    default:
      throw new Error(`non-literal node type in ${path}: ${node.type}`)
  }
}

function propertyKey(node: AnyNode, path: string): string {
  if (node.type === 'Identifier') {
    return node.name
  }
  if (node.type === 'Literal' && (typeof node.value === 'string' || typeof node.value === 'number')) {
    return String(node.value)
  }
  throw new Error(`unsupported key type in ${path}: ${node.type}`)
}

function assertDeterministicAst(node: AnyNode): void {
  if (isDateNowCall(node) || isMathRandomCall(node) || isNewDateExpression(node)) {
    throw new Error(NONDETERMINISM_ERROR)
  }

  for (const child of astChildren(node)) {
    assertDeterministicAst(child)
  }
}

function astChildren(node: AnyNode): AnyNode[] {
  const children: AnyNode[] = []
  for (const value of Object.values(node)) {
    if (Array.isArray(value)) {
      children.push(...value.filter(isAstNode))
    } else if (isAstNode(value)) {
      children.push(value)
    }
  }
  return children
}

function isAstNode(value: unknown): value is AnyNode {
  return Boolean(value) && typeof value === 'object' && typeof (value as AnyNode).type === 'string'
}

function isDateNowCall(node: AnyNode): boolean {
  return node.type === 'CallExpression' && isMemberExpression(node.callee, 'Date', 'now')
}

function isMathRandomCall(node: AnyNode): boolean {
  return node.type === 'CallExpression' && isMemberExpression(node.callee, 'Math', 'random')
}

function isNewDateExpression(node: AnyNode): boolean {
  return node.type === 'NewExpression' && node.callee?.type === 'Identifier' && node.callee.name === 'Date'
}

function isMemberExpression(node: AnyNode | undefined, objectName: string, propertyName: string): boolean {
  if (node?.type !== 'MemberExpression' || node.object?.type !== 'Identifier' || node.object.name !== objectName) {
    return false
  }
  return propertyNameOf(node) === propertyName
}

function propertyNameOf(node: AnyNode): string | undefined {
  if (!node.computed && node.property?.type === 'Identifier') {
    return node.property.name
  }
  return staticStringOf(node.property)
}

function staticStringOf(node: AnyNode | undefined): string | undefined {
  if (node?.type === 'Literal' && typeof node.value === 'string') {
    return node.value
  }
  if (node?.type === 'TemplateLiteral' && node.expressions.length === 0) {
    return node.quasis.map((quasi: AnyNode) => quasi.value.cooked ?? quasi.value.raw).join('')
  }
  if (node?.type === 'BinaryExpression' && node.operator === '+') {
    const left = staticStringOf(node.left)
    const right = staticStringOf(node.right)
    if (left !== undefined && right !== undefined) {
      return left + right
    }
  }
  return undefined
}

function validateMeta(meta: unknown): asserts meta is WorkflowMeta {
  if (!meta || typeof meta !== 'object') {
    throw new Error('meta must be an object')
  }
  const value = meta as WorkflowMeta
  if (typeof value.name !== 'string' || !value.name.trim()) {
    throw new Error('meta.name must be a non-empty string')
  }
  if (typeof value.description !== 'string' || !value.description.trim()) {
    throw new Error('meta.description must be a non-empty string')
  }
  if (value.whenToUse !== undefined && typeof value.whenToUse !== 'string') {
    throw new Error('meta.whenToUse must be a string')
  }
  if (value.phases !== undefined) {
    if (!Array.isArray(value.phases)) {
      throw new Error('meta.phases must be an array')
    }
    for (const phase of value.phases) {
      if (!phase || typeof phase !== 'object' || typeof (phase as WorkflowMetaPhase).title !== 'string') {
        throw new Error('each meta phase must have a title string')
      }
    }
  }
}
