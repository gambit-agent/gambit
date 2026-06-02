import { useEffect, useState } from 'react'
import type { Role } from '../types/chat'

export interface Theme {
  background: string
  panel: string
  header: string
  headerAccent: string
  logoFg: string
  border: string
  headerBorder: string
  bodyBorder: string
  assistantBg: string
  assistantFg: string
  responseStrongFg: string
  reasoningBg: string
  reasoningFg: string
  reasoningBorder: string
  userBg: string
  userFg: string
  toolBg: string
  toolBorder: string
  toolFg: string
  systemBg: string
  systemFg: string
  statusFg: string
  inputBg: string
  inputBorder: string
  inputFocusedBg: string
  divider: string
  headingFg: string
  errorFg: string
  errorBg: string
  successFg: string
  successBg: string
  infoFg: string
  warningFg: string
  warningAccent: string
  diffAddedFg: string
  diffRemovedFg: string
  diffLineNumberFg: string
  selectedBg: string
  selectedFg: string
  descriptionFg: string
  codeInlineBg: string
  codeInlineFg: string
  codeBlockBg: string
  codeBlockFg: string
  codeBlockBorder: string
  codeBlockAccent: string
  blockquoteBg: string
  blockquoteBorder: string
  linkFg: string
  linkSecondaryFg: string
  listBulletFg: string
  tableBg: string
  tableFg: string
}

const darkTheme: Theme = {
  background: '#131313',
  panel: '#141414',
  header: '#181818',
  headerAccent: '#FFB6C1',
  logoFg: '#FFB6C1',
  border: '#FFB6C1',
  headerBorder: '#292929',
  bodyBorder: '#222222',
  assistantBg: '#030303',
  assistantFg: '#C9D1D9',
  responseStrongFg: '#F0C6D0',
  reasoningBg: '#151A20',
  reasoningFg: '#9FB3C8',
  reasoningBorder: '#3B5168',
  userBg: '#1b1b1b',
  userFg: '#ffffff',
  toolBg: '#321f33',
  toolBorder: '#9b73aa',
  toolFg: '#FFB6C1',
  systemBg: '#1a2236',
  systemFg: '#b2c3f0',
  statusFg: '#4D4E4E',
  inputBg: '#0f1726',
  inputBorder: '#808080',
  inputFocusedBg: '#141414',
  divider: '#1f2940',
  headingFg: '#E6EDF3',
  errorFg: '#ff6b6b',
  errorBg: '#3a1f1f',
  successFg: '#7ee787',
  successBg: '#16351f',
  infoFg: '#79c0ff',
  warningFg: '#FFB6C1',
  warningAccent: '#FFB6C1',
  diffAddedFg: '#3fb950',
  diffRemovedFg: '#f85149',
  diffLineNumberFg: '#8b949e',
  selectedBg: '#1a1a1a',
  selectedFg: '#FFB6C1',
  descriptionFg: '#4D4E4E',
  codeInlineBg: '#26313A',
  codeInlineFg: '#F4D3DD',
  codeBlockBg: '#171B22',
  codeBlockFg: '#D6DEEB',
  codeBlockBorder: '#344054',
  codeBlockAccent: '#79C0FF',
  blockquoteBg: '#161B22',
  blockquoteBorder: '#42526B',
  linkFg: '#8cb4ff',
  linkSecondaryFg: '#5c719b',
  listBulletFg: '#8CB4FF',
  tableBg: '#16181f',
  tableFg: '#cdd6f4',
}

const lightTheme: Theme = {
  background: '#FFFFFF',
  panel: '#F5F5F5',
  header: '#FAFAFA',
  headerAccent: '#D6336C',
  logoFg: '#D6336C',
  border: '#D6336C',
  headerBorder: '#E0E0E0',
  bodyBorder: '#E8E8E8',
  assistantBg: '#F8F8F8',
  assistantFg: '#24292F',
  responseStrongFg: '#8A2044',
  reasoningBg: '#F3F7FB',
  reasoningFg: '#576575',
  reasoningBorder: '#9DB6D8',
  userBg: '#E3F0FF',
  userFg: '#000000',
  toolBg: '#F8F0FF',
  toolBorder: '#C77DFF',
  toolFg: '#7B2D8E',
  systemBg: '#EEF1F8',
  systemFg: '#2C3E6B',
  statusFg: '#999999',
  inputBg: '#FFFFFF',
  inputBorder: '#CCCCCC',
  inputFocusedBg: '#F8F8F8',
  divider: '#E0E0E0',
  headingFg: '#1F2937',
  errorFg: '#D32F2F',
  errorBg: '#FFEBEE',
  successFg: '#2E7D32',
  successBg: '#E8F5E9',
  infoFg: '#1565C0',
  warningFg: '#E65100',
  warningAccent: '#E65100',
  diffAddedFg: '#2E7D32',
  diffRemovedFg: '#C62828',
  diffLineNumberFg: '#999999',
  selectedBg: '#E0E0E0',
  selectedFg: '#D6336C',
  descriptionFg: '#999999',
  codeInlineBg: '#E8EEF6',
  codeInlineFg: '#243B53',
  codeBlockBg: '#F6F8FA',
  codeBlockFg: '#24292F',
  codeBlockBorder: '#CBD5E1',
  codeBlockAccent: '#2563EB',
  blockquoteBg: '#F6F8FA',
  blockquoteBorder: '#CBD5E1',
  linkFg: '#1565C0',
  linkSecondaryFg: '#5C719B',
  listBulletFg: '#2563EB',
  tableBg: '#FFFFFF',
  tableFg: '#333333',
}

export const theme: Theme = { ...darkTheme }

let isLight = false

const listeners = new Set<() => void>()

export function toggleTheme(): void {
  isLight = !isLight
  const source = isLight ? lightTheme : darkTheme
  for (const key of Object.keys(source) as (keyof Theme)[]) {
    theme[key] = source[key]
  }
  for (const fn of listeners) {
    fn()
  }
}

export function useTheme(): { theme: Theme; isLight: boolean; toggleTheme: () => void } {
  const [, forceUpdate] = useState(0)
  useEffect(() => {
    const fn = () => forceUpdate((n) => n + 1)
    listeners.add(fn)
    return () => {
      listeners.delete(fn)
    }
  }, [])
  return { theme, isLight, toggleTheme }
}

export const layout = {
  screenPadding: 1,
  sectionGap: 1,
  panelGap: 1,
  panelPaddingX: 2,
  panelPaddingY: 1,
  statusGap: 2,
  messagePaddingX: 2,
  messagePaddingY: 1,
  markdownBlockGap: 1,
  inputRowMinHeight: 3,
} as const

export function getRolePresentation(
  role: Role,
  t: Theme,
): { label: string; backgroundColor: string; textColor: string; borderColor: string } {
  switch (role) {
    case 'assistant':
      return {
        label: 'Assistant',
        backgroundColor: t.assistantBg,
        textColor: t.assistantFg,
        borderColor: t.bodyBorder,
      }
    case 'user':
      return {
        label: 'You',
        backgroundColor: t.userBg,
        textColor: t.userFg,
        borderColor: t.bodyBorder,
      }
    case 'tool':
      return {
        label: 'Tool',
        backgroundColor: t.toolBg,
        textColor: t.toolFg,
        borderColor: t.toolBorder,
      }
    case 'system':
      return {
        label: 'System',
        backgroundColor: t.systemBg,
        textColor: t.systemFg,
        borderColor: t.bodyBorder,
      }
  }
}
