import type { Role } from '../types/chat'

export const theme = {
  background: '#0a0a0a',
  panel: '#141414',
  header: '#181818',
  headerAccent: '#ffc17a', // model name in header
  border: '#ffc17a',
  headerBorder: '#292929',
  bodyBorder: '#222222',
  assistantBg: '#030303',
  assistantFg: '#b4b4b4',
  userBg: '#1b1b1b',
  userFg: '#ffffff', // user text color
  toolBg: '#321f33',
  toolBorder: '#9b73aa',
  toolFg: '#ffd6f7',
  systemBg: '#1a2236',
  systemFg: '#b2c3f0',
  statusFg: '#9aa7c6',
  inputBg: '#0f1726',
  inputBorder: '#ffc17a',
  inputFocusedBg: '#141414',
  divider: '#1f2940',
  headingFg: '#cfdcff',
  codeInlineBg: '#2b2b2b',
  codeInlineFg: '#f3f3f3',
  codeBlockBg: '#191a24',
  codeBlockFg: '#e4e9ff',
  codeBlockBorder: '#2d3352',
  codeBlockAccent: '#7aa2ff',
  blockquoteBg: '#101420',
  blockquoteBorder: '#2d3352',
  linkFg: '#8cb4ff',
  linkSecondaryFg: '#5c719b',
  listBulletFg: '#7aa2ff',
  tableBg: '#16181f',
  tableFg: '#cdd6f4',
} as const

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

export const rolePresentation: Record<
  Role,
  { label: string; backgroundColor: string; textColor: string; borderColor: string }
> = {
  assistant: {
    label: 'Assistant',
    backgroundColor: theme.assistantBg,
    textColor: theme.assistantFg,
    borderColor: theme.bodyBorder,
  },
  user: {
    label: 'You',
    backgroundColor: theme.userBg,
    textColor: theme.userFg,
    borderColor: theme.bodyBorder,
  },
  tool: {
    label: 'Tool',
    backgroundColor: theme.toolBg,
    textColor: theme.toolFg,
    borderColor: theme.toolBorder,
  },
  system: {
    label: 'System',
    backgroundColor: theme.systemBg,
    textColor: theme.systemFg,
    borderColor: theme.bodyBorder,
  },
}
