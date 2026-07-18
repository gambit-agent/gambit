import { routeCommandInput, type RoutedInput } from './command-router'

export function routeInput(value: string): RoutedInput {
  return routeCommandInput(value)
}
