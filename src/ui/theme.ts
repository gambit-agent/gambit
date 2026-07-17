import { useEffect, useState } from 'react'
import type { Role } from '../types/chat'

export interface Theme {
  mode: 'light' | 'dark'
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

export interface ThemeDefinition {
  id: string
  name: string
  mode: 'light' | 'dark'
  colors: Theme
}

// ---------------------------------------------------------------------------
// Theme palettes
// ---------------------------------------------------------------------------

const gambitDark: Theme = {
  mode: 'dark',
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
  reasoningBg: '#1C1C1C',
  reasoningFg: '#FFB6C1',
  reasoningBorder: '#FFB6C1',
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

const gambitLight: Theme = {
  mode: 'light',
  background: '#FFFFFF',
  panel: '#F5F5F5',
  header: '#FAFAFA',
  headerAccent: '#D6336C',
  logoFg: '#FFB6C1',
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

const githubDark: Theme = {
  mode: 'dark',
  background: '#0d1117',
  panel: '#161b22',
  header: '#161b22',
  headerAccent: '#58a6ff',
  logoFg: '#58a6ff',
  border: '#58a6ff',
  headerBorder: '#30363d',
  bodyBorder: '#21262d',
  assistantBg: '#010409',
  assistantFg: '#c9d1d9',
  responseStrongFg: '#79c0ff',
  reasoningBg: '#161b22',
  reasoningFg: '#8b949e',
  reasoningBorder: '#58a6ff',
  userBg: '#1c2128',
  userFg: '#ffffff',
  toolBg: '#1c2128',
  toolBorder: '#6e7681',
  toolFg: '#79c0ff',
  systemBg: '#161b22',
  systemFg: '#8b949e',
  statusFg: '#6e7681',
  inputBg: '#0d1117',
  inputBorder: '#30363d',
  inputFocusedBg: '#161b22',
  divider: '#21262d',
  headingFg: '#e6edf3',
  errorFg: '#f85149',
  errorBg: '#4a2424',
  successFg: '#3fb950',
  successBg: '#1a3b1f',
  infoFg: '#58a6ff',
  warningFg: '#d29922',
  warningAccent: '#d29922',
  diffAddedFg: '#3fb950',
  diffRemovedFg: '#f85149',
  diffLineNumberFg: '#6e7681',
  selectedBg: '#1c2128',
  selectedFg: '#58a6ff',
  descriptionFg: '#6e7681',
  codeInlineBg: '#1c2128',
  codeInlineFg: '#79c0ff',
  codeBlockBg: '#161b22',
  codeBlockFg: '#c9d1d9',
  codeBlockBorder: '#30363d',
  codeBlockAccent: '#58a6ff',
  blockquoteBg: '#161b22',
  blockquoteBorder: '#30363d',
  linkFg: '#58a6ff',
  linkSecondaryFg: '#6e7681',
  listBulletFg: '#58a6ff',
  tableBg: '#161b22',
  tableFg: '#c9d1d9',
}

const githubLight: Theme = {
  mode: 'light',
  background: '#ffffff',
  panel: '#f6f8fa',
  header: '#f6f8fa',
  headerAccent: '#0969da',
  logoFg: '#0969da',
  border: '#0969da',
  headerBorder: '#d0d7de',
  bodyBorder: '#d0d7de',
  assistantBg: '#f6f8fa',
  assistantFg: '#1f2328',
  responseStrongFg: '#0550ae',
  reasoningBg: '#f6f8fa',
  reasoningFg: '#656d76',
  reasoningBorder: '#0969da',
  userBg: '#ddf4ff',
  userFg: '#000000',
  toolBg: '#f6f8fa',
  toolBorder: '#8250df',
  toolFg: '#8250df',
  systemBg: '#f6f8fa',
  systemFg: '#656d76',
  statusFg: '#8c959f',
  inputBg: '#ffffff',
  inputBorder: '#d0d7de',
  inputFocusedBg: '#f6f8fa',
  divider: '#d0d7de',
  headingFg: '#1f2328',
  errorFg: '#cf222e',
  errorBg: '#ffebe9',
  successFg: '#1a7f37',
  successBg: '#dafbe1',
  infoFg: '#0969da',
  warningFg: '#9a6700',
  warningAccent: '#9a6700',
  diffAddedFg: '#1a7f37',
  diffRemovedFg: '#cf222e',
  diffLineNumberFg: '#8c959f',
  selectedBg: '#ddf4ff',
  selectedFg: '#0969da',
  descriptionFg: '#8c959f',
  codeInlineBg: '#eff2f5',
  codeInlineFg: '#0550ae',
  codeBlockBg: '#f6f8fa',
  codeBlockFg: '#1f2328',
  codeBlockBorder: '#d0d7de',
  codeBlockAccent: '#0969da',
  blockquoteBg: '#f6f8fa',
  blockquoteBorder: '#d0d7de',
  linkFg: '#0969da',
  linkSecondaryFg: '#57606a',
  listBulletFg: '#0969da',
  tableBg: '#ffffff',
  tableFg: '#1f2328',
}

const dracula: Theme = {
  mode: 'dark',
  background: '#282a36',
  panel: '#21222c',
  header: '#21222c',
  headerAccent: '#bd93f9',
  logoFg: '#ff79c6',
  border: '#ff79c6',
  headerBorder: '#343746',
  bodyBorder: '#343746',
  assistantBg: '#21222c',
  assistantFg: '#f8f8f2',
  responseStrongFg: '#ff79c6',
  reasoningBg: '#21222c',
  reasoningFg: '#6272a4',
  reasoningBorder: '#bd93f9',
  userBg: '#343746',
  userFg: '#f8f8f2',
  toolBg: '#343746',
  toolBorder: '#bd93f9',
  toolFg: '#8be9fd',
  systemBg: '#21222c',
  systemFg: '#6272a4',
  statusFg: '#6272a4',
  inputBg: '#21222c',
  inputBorder: '#44475a',
  inputFocusedBg: '#343746',
  divider: '#44475a',
  headingFg: '#ff79c6',
  errorFg: '#ff5555',
  errorBg: '#3a1f24',
  successFg: '#50fa7b',
  successBg: '#1f3a28',
  infoFg: '#8be9fd',
  warningFg: '#f1fa8c',
  warningAccent: '#ffb86c',
  diffAddedFg: '#50fa7b',
  diffRemovedFg: '#ff5555',
  diffLineNumberFg: '#6272a4',
  selectedBg: '#44475a',
  selectedFg: '#f8f8f2',
  descriptionFg: '#6272a4',
  codeInlineBg: '#44475a',
  codeInlineFg: '#50fa7b',
  codeBlockBg: '#21222c',
  codeBlockFg: '#f8f8f2',
  codeBlockBorder: '#44475a',
  codeBlockAccent: '#bd93f9',
  blockquoteBg: '#21222c',
  blockquoteBorder: '#44475a',
  linkFg: '#8be9fd',
  linkSecondaryFg: '#6272a4',
  listBulletFg: '#ff79c6',
  tableBg: '#21222c',
  tableFg: '#f8f8f2',
}

const oneDark: Theme = {
  mode: 'dark',
  background: '#282c34',
  panel: '#21252b',
  header: '#21252b',
  headerAccent: '#61afef',
  logoFg: '#c678dd',
  border: '#c678dd',
  headerBorder: '#3b4048',
  bodyBorder: '#3b4048',
  assistantBg: '#21252b',
  assistantFg: '#abb2bf',
  responseStrongFg: '#c678dd',
  reasoningBg: '#21252b',
  reasoningFg: '#5c6370',
  reasoningBorder: '#61afef',
  userBg: '#2c313c',
  userFg: '#ffffff',
  toolBg: '#2c313c',
  toolBorder: '#c678dd',
  toolFg: '#56b6c2',
  systemBg: '#21252b',
  systemFg: '#5c6370',
  statusFg: '#5c6370',
  inputBg: '#21252b',
  inputBorder: '#3b4048',
  inputFocusedBg: '#2c313c',
  divider: '#3b4048',
  headingFg: '#e5c07b',
  errorFg: '#e06c75',
  errorBg: '#3a2024',
  successFg: '#98c379',
  successBg: '#1f3a24',
  infoFg: '#61afef',
  warningFg: '#e5c07b',
  warningAccent: '#d19a66',
  diffAddedFg: '#98c379',
  diffRemovedFg: '#e06c75',
  diffLineNumberFg: '#5c6370',
  selectedBg: '#2c313c',
  selectedFg: '#61afef',
  descriptionFg: '#5c6370',
  codeInlineBg: '#2c313c',
  codeInlineFg: '#98c379',
  codeBlockBg: '#21252b',
  codeBlockFg: '#abb2bf',
  codeBlockBorder: '#3b4048',
  codeBlockAccent: '#61afef',
  blockquoteBg: '#21252b',
  blockquoteBorder: '#3b4048',
  linkFg: '#61afef',
  linkSecondaryFg: '#5c6370',
  listBulletFg: '#c678dd',
  tableBg: '#21252b',
  tableFg: '#abb2bf',
}

const monokaiPro: Theme = {
  mode: 'dark',
  background: '#2d2a2e',
  panel: '#221f22',
  header: '#221f22',
  headerAccent: '#ab9df2',
  logoFg: '#ff6188',
  border: '#ff6188',
  headerBorder: '#3a363c',
  bodyBorder: '#3a363c',
  assistantBg: '#221f22',
  assistantFg: '#fcfcfa',
  responseStrongFg: '#ffd866',
  reasoningBg: '#221f22',
  reasoningFg: '#727072',
  reasoningBorder: '#ab9df2',
  userBg: '#36322f',
  userFg: '#fcfcfa',
  toolBg: '#36322f',
  toolBorder: '#ab9df2',
  toolFg: '#78dce8',
  systemBg: '#221f22',
  systemFg: '#727072',
  statusFg: '#727072',
  inputBg: '#221f22',
  inputBorder: '#3a363c',
  inputFocusedBg: '#36322f',
  divider: '#3a363c',
  headingFg: '#ffd866',
  errorFg: '#ff6188',
  errorBg: '#3a1f24',
  successFg: '#a9dc76',
  successBg: '#1f3a24',
  infoFg: '#78dce8',
  warningFg: '#fc9867',
  warningAccent: '#fc9867',
  diffAddedFg: '#a9dc76',
  diffRemovedFg: '#ff6188',
  diffLineNumberFg: '#727072',
  selectedBg: '#403e41',
  selectedFg: '#fcfcfa',
  descriptionFg: '#727072',
  codeInlineBg: '#403e41',
  codeInlineFg: '#a9dc76',
  codeBlockBg: '#221f22',
  codeBlockFg: '#fcfcfa',
  codeBlockBorder: '#403e41',
  codeBlockAccent: '#ab9df2',
  blockquoteBg: '#221f22',
  blockquoteBorder: '#403e41',
  linkFg: '#78dce8',
  linkSecondaryFg: '#727072',
  listBulletFg: '#ff6188',
  tableBg: '#221f22',
  tableFg: '#fcfcfa',
}

const solarizedDark: Theme = {
  mode: 'dark',
  background: '#002b36',
  panel: '#073642',
  header: '#073642',
  headerAccent: '#268bd2',
  logoFg: '#2aa198',
  border: '#2aa198',
  headerBorder: '#0d4048',
  bodyBorder: '#0d4048',
  assistantBg: '#073642',
  assistantFg: '#93a1a1',
  responseStrongFg: '#b58900',
  reasoningBg: '#073642',
  reasoningFg: '#586e75',
  reasoningBorder: '#268bd2',
  userBg: '#0d4048',
  userFg: '#eee8d5',
  toolBg: '#0d4048',
  toolBorder: '#2aa198',
  toolFg: '#2aa198',
  systemBg: '#073642',
  systemFg: '#586e75',
  statusFg: '#586e75',
  inputBg: '#073642',
  inputBorder: '#0d4048',
  inputFocusedBg: '#0d4048',
  divider: '#0d4048',
  headingFg: '#b58900',
  errorFg: '#dc322f',
  errorBg: '#3a1c1c',
  successFg: '#859900',
  successBg: '#1f3a14',
  infoFg: '#268bd2',
  warningFg: '#b58900',
  warningAccent: '#cb4b16',
  diffAddedFg: '#859900',
  diffRemovedFg: '#dc322f',
  diffLineNumberFg: '#586e75',
  selectedBg: '#0d4048',
  selectedFg: '#93a1a1',
  descriptionFg: '#586e75',
  codeInlineBg: '#0d4048',
  codeInlineFg: '#859900',
  codeBlockBg: '#073642',
  codeBlockFg: '#93a1a1',
  codeBlockBorder: '#0d4048',
  codeBlockAccent: '#268bd2',
  blockquoteBg: '#073642',
  blockquoteBorder: '#0d4048',
  linkFg: '#268bd2',
  linkSecondaryFg: '#586e75',
  listBulletFg: '#2aa198',
  tableBg: '#073642',
  tableFg: '#93a1a1',
}

const solarizedLight: Theme = {
  mode: 'light',
  background: '#fdf6e3',
  panel: '#eee8d5',
  header: '#eee8d5',
  headerAccent: '#268bd2',
  logoFg: '#2aa198',
  border: '#2aa198',
  headerBorder: '#e0d8c0',
  bodyBorder: '#e0d8c0',
  assistantBg: '#eee8d5',
  assistantFg: '#586e75',
  responseStrongFg: '#b58900',
  reasoningBg: '#eee8d5',
  reasoningFg: '#93a1a1',
  reasoningBorder: '#268bd2',
  userBg: '#e0d8c0',
  userFg: '#073642',
  toolBg: '#e0d8c0',
  toolBorder: '#2aa198',
  toolFg: '#2aa198',
  systemBg: '#eee8d5',
  systemFg: '#93a1a1',
  statusFg: '#93a1a1',
  inputBg: '#fdf6e3',
  inputBorder: '#e0d8c0',
  inputFocusedBg: '#eee8d5',
  divider: '#e0d8c0',
  headingFg: '#b58900',
  errorFg: '#dc322f',
  errorBg: '#fbe3e1',
  successFg: '#859900',
  successBg: '#e8f0d8',
  infoFg: '#268bd2',
  warningFg: '#b58900',
  warningAccent: '#cb4b16',
  diffAddedFg: '#859900',
  diffRemovedFg: '#dc322f',
  diffLineNumberFg: '#93a1a1',
  selectedBg: '#e0d8c0',
  selectedFg: '#073642',
  descriptionFg: '#93a1a1',
  codeInlineBg: '#e0d8c0',
  codeInlineFg: '#859900',
  codeBlockBg: '#eee8d5',
  codeBlockFg: '#586e75',
  codeBlockBorder: '#e0d8c0',
  codeBlockAccent: '#268bd2',
  blockquoteBg: '#eee8d5',
  blockquoteBorder: '#e0d8c0',
  linkFg: '#268bd2',
  linkSecondaryFg: '#93a1a1',
  listBulletFg: '#2aa198',
  tableBg: '#eee8d5',
  tableFg: '#586e75',
}

const nord: Theme = {
  mode: 'dark',
  background: '#2e3440',
  panel: '#3b4252',
  header: '#3b4252',
  headerAccent: '#88c0d0',
  logoFg: '#81a1c1',
  border: '#81a1c1',
  headerBorder: '#434c5e',
  bodyBorder: '#434c5e',
  assistantBg: '#3b4252',
  assistantFg: '#d8dee9',
  responseStrongFg: '#88c0d0',
  reasoningBg: '#3b4252',
  reasoningFg: '#616e88',
  reasoningBorder: '#88c0d0',
  userBg: '#434c5e',
  userFg: '#e5e9f0',
  toolBg: '#434c5e',
  toolBorder: '#88c0d0',
  toolFg: '#8fbcbb',
  systemBg: '#3b4252',
  systemFg: '#616e88',
  statusFg: '#616e88',
  inputBg: '#3b4252',
  inputBorder: '#434c5e',
  inputFocusedBg: '#434c5e',
  divider: '#434c5e',
  headingFg: '#81a1c1',
  errorFg: '#bf616a',
  errorBg: '#3b2024',
  successFg: '#a3be8c',
  successBg: '#2a3a24',
  infoFg: '#81a1c1',
  warningFg: '#ebcb8b',
  warningAccent: '#d08770',
  diffAddedFg: '#a3be8c',
  diffRemovedFg: '#bf616a',
  diffLineNumberFg: '#616e88',
  selectedBg: '#434c5e',
  selectedFg: '#88c0d0',
  descriptionFg: '#616e88',
  codeInlineBg: '#434c5e',
  codeInlineFg: '#a3be8c',
  codeBlockBg: '#3b4252',
  codeBlockFg: '#d8dee9',
  codeBlockBorder: '#434c5e',
  codeBlockAccent: '#88c0d0',
  blockquoteBg: '#3b4252',
  blockquoteBorder: '#434c5e',
  linkFg: '#81a1c1',
  linkSecondaryFg: '#616e88',
  listBulletFg: '#81a1c1',
  tableBg: '#3b4252',
  tableFg: '#d8dee9',
}

const tokyoNight: Theme = {
  mode: 'dark',
  background: '#1a1b26',
  panel: '#16161e',
  header: '#16161e',
  headerAccent: '#7aa2f7',
  logoFg: '#bb9af7',
  border: '#bb9af7',
  headerBorder: '#2a2b3d',
  bodyBorder: '#2a2b3d',
  assistantBg: '#16161e',
  assistantFg: '#a9b1d6',
  responseStrongFg: '#bb9af7',
  reasoningBg: '#16161e',
  reasoningFg: '#565f89',
  reasoningBorder: '#7aa2f7',
  userBg: '#24283b',
  userFg: '#c0caf5',
  toolBg: '#24283b',
  toolBorder: '#7aa2f7',
  toolFg: '#7dcfff',
  systemBg: '#16161e',
  systemFg: '#565f89',
  statusFg: '#565f89',
  inputBg: '#16161e',
  inputBorder: '#2a2b3d',
  inputFocusedBg: '#24283b',
  divider: '#2a2b3d',
  headingFg: '#7aa2f7',
  errorFg: '#f7768e',
  errorBg: '#3a1f28',
  successFg: '#9ece6a',
  successBg: '#1f3a24',
  infoFg: '#7aa2f7',
  warningFg: '#e0af68',
  warningAccent: '#ff9e64',
  diffAddedFg: '#9ece6a',
  diffRemovedFg: '#f7768e',
  diffLineNumberFg: '#565f89',
  selectedBg: '#24283b',
  selectedFg: '#7aa2f7',
  descriptionFg: '#565f89',
  codeInlineBg: '#24283b',
  codeInlineFg: '#9ece6a',
  codeBlockBg: '#16161e',
  codeBlockFg: '#a9b1d6',
  codeBlockBorder: '#2a2b3d',
  codeBlockAccent: '#7aa2f7',
  blockquoteBg: '#16161e',
  blockquoteBorder: '#2a2b3d',
  linkFg: '#7aa2f7',
  linkSecondaryFg: '#565f89',
  listBulletFg: '#bb9af7',
  tableBg: '#16161e',
  tableFg: '#a9b1d6',
}

const gruvboxDark: Theme = {
  mode: 'dark',
  background: '#282828',
  panel: '#1d2021',
  header: '#1d2021',
  headerAccent: '#fabd2f',
  logoFg: '#d3869b',
  border: '#d3869b',
  headerBorder: '#3c3836',
  bodyBorder: '#3c3836',
  assistantBg: '#1d2021',
  assistantFg: '#ebdbb2',
  responseStrongFg: '#fe8019',
  reasoningBg: '#1d2021',
  reasoningFg: '#928374',
  reasoningBorder: '#fabd2f',
  userBg: '#3c3836',
  userFg: '#ebdbb2',
  toolBg: '#3c3836',
  toolBorder: '#fabd2f',
  toolFg: '#8ec07c',
  systemBg: '#1d2021',
  systemFg: '#928374',
  statusFg: '#928374',
  inputBg: '#1d2021',
  inputBorder: '#3c3836',
  inputFocusedBg: '#3c3836',
  divider: '#3c3836',
  headingFg: '#fabd2f',
  errorFg: '#fb4934',
  errorBg: '#3a1c1c',
  successFg: '#b8bb26',
  successBg: '#2a3a14',
  infoFg: '#83a598',
  warningFg: '#fabd2f',
  warningAccent: '#fe8019',
  diffAddedFg: '#b8bb26',
  diffRemovedFg: '#fb4934',
  diffLineNumberFg: '#928374',
  selectedBg: '#3c3836',
  selectedFg: '#fabd2f',
  descriptionFg: '#928374',
  codeInlineBg: '#3c3836',
  codeInlineFg: '#b8bb26',
  codeBlockBg: '#1d2021',
  codeBlockFg: '#ebdbb2',
  codeBlockBorder: '#3c3836',
  codeBlockAccent: '#fabd2f',
  blockquoteBg: '#1d2021',
  blockquoteBorder: '#3c3836',
  linkFg: '#83a598',
  linkSecondaryFg: '#928374',
  listBulletFg: '#d3869b',
  tableBg: '#1d2021',
  tableFg: '#ebdbb2',
}

const catppuccinMocha: Theme = {
  mode: 'dark',
  background: '#1e1e2e',
  panel: '#181825',
  header: '#181825',
  headerAccent: '#cba6f7',
  logoFg: '#f5c2e7',
  border: '#f5c2e7',
  headerBorder: '#313244',
  bodyBorder: '#313244',
  assistantBg: '#181825',
  assistantFg: '#cdd6f4',
  responseStrongFg: '#f5c2e7',
  reasoningBg: '#181825',
  reasoningFg: '#6c7086',
  reasoningBorder: '#cba6f7',
  userBg: '#313244',
  userFg: '#cdd6f4',
  toolBg: '#313244',
  toolBorder: '#cba6f7',
  toolFg: '#94e2d5',
  systemBg: '#181825',
  systemFg: '#6c7086',
  statusFg: '#6c7086',
  inputBg: '#181825',
  inputBorder: '#313244',
  inputFocusedBg: '#313244',
  divider: '#313244',
  headingFg: '#cba6f7',
  errorFg: '#f38ba8',
  errorBg: '#3a2430',
  successFg: '#a6e3a1',
  successBg: '#243a28',
  infoFg: '#89b4fa',
  warningFg: '#f9e2af',
  warningAccent: '#fab387',
  diffAddedFg: '#a6e3a1',
  diffRemovedFg: '#f38ba8',
  diffLineNumberFg: '#6c7086',
  selectedBg: '#313244',
  selectedFg: '#cba6f7',
  descriptionFg: '#6c7086',
  codeInlineBg: '#313244',
  codeInlineFg: '#a6e3a1',
  codeBlockBg: '#181825',
  codeBlockFg: '#cdd6f4',
  codeBlockBorder: '#313244',
  codeBlockAccent: '#cba6f7',
  blockquoteBg: '#181825',
  blockquoteBorder: '#313244',
  linkFg: '#89b4fa',
  linkSecondaryFg: '#6c7086',
  listBulletFg: '#f5c2e7',
  tableBg: '#181825',
  tableFg: '#cdd6f4',
}

// ---------------------------------------------------------------------------
// Registry
// ---------------------------------------------------------------------------

export const themes: readonly ThemeDefinition[] = [
  { id: 'gambit-dark', name: 'Gambit Dark', mode: 'dark', colors: gambitDark },
  { id: 'gambit-light', name: 'Gambit Light', mode: 'light', colors: gambitLight },
  { id: 'github-dark', name: 'GitHub Dark', mode: 'dark', colors: githubDark },
  { id: 'github-light', name: 'GitHub Light', mode: 'light', colors: githubLight },
  { id: 'dracula', name: 'Dracula', mode: 'dark', colors: dracula },
  { id: 'one-dark', name: 'One Dark', mode: 'dark', colors: oneDark },
  { id: 'monokai-pro', name: 'Monokai Pro', mode: 'dark', colors: monokaiPro },
  { id: 'solarized-dark', name: 'Solarized Dark', mode: 'dark', colors: solarizedDark },
  { id: 'solarized-light', name: 'Solarized Light', mode: 'light', colors: solarizedLight },
  { id: 'nord', name: 'Nord', mode: 'dark', colors: nord },
  { id: 'tokyo-night', name: 'Tokyo Night', mode: 'dark', colors: tokyoNight },
  { id: 'gruvbox-dark', name: 'Gruvbox Dark', mode: 'dark', colors: gruvboxDark },
  { id: 'catppuccin-mocha', name: 'Catppuccin Mocha', mode: 'dark', colors: catppuccinMocha },
]

const DEFAULT_THEME_ID = 'gambit-dark'

const themeMap: ReadonlyMap<string, ThemeDefinition> = new Map(
  themes.map((def) => [def.id, def]),
)

// ---------------------------------------------------------------------------
// Mutable state — consumers read `theme.*` directly; useTheme() triggers re-renders
// ---------------------------------------------------------------------------

export const theme: Theme = { ...gambitDark }

let activeThemeId: string = DEFAULT_THEME_ID
let isLight: boolean = false

const listeners = new Set<() => void>()

function applyThemeColors(source: Theme): void {
  Object.assign(theme, source)
}

function notifyListeners(): void {
  for (const fn of listeners) {
    fn()
  }
}

export function applyTheme(id: string): void {
  const def = themeMap.get(id) ?? themeMap.get(DEFAULT_THEME_ID)!
  activeThemeId = def.id
  isLight = def.mode === 'light'
  applyThemeColors(def.colors)
  notifyListeners()
}

export function getThemeById(id: string): ThemeDefinition | undefined {
  return themeMap.get(id)
}

export function getThemeList(): { id: string; name: string; mode: 'light' | 'dark' }[] {
  return themes.map((def) => ({ id: def.id, name: def.name, mode: def.mode }))
}

export function getActiveThemeId(): string {
  return activeThemeId
}

export function getActiveThemeName(): string {
  return themeMap.get(activeThemeId)?.name ?? DEFAULT_THEME_ID
}

function toggleTheme(): void {
  applyTheme(isLight ? DEFAULT_THEME_ID : 'gambit-light')
}

export function useTheme(): {
  theme: Theme
  isLight: boolean
  activeThemeId: string
  themeName: string
  applyTheme: (id: string) => void
  toggleTheme: () => void
} {
  const [, forceUpdate] = useState(0)
  useEffect(() => {
    const fn = () => forceUpdate((n) => n + 1)
    listeners.add(fn)
    return () => {
      listeners.delete(fn)
    }
  }, [])
  return {
    theme,
    isLight,
    activeThemeId,
    themeName: getActiveThemeName(),
    applyTheme,
    toggleTheme,
  }
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
