import { access } from 'node:fs/promises'
import { constants } from 'node:fs'
import { delimiter, extname, isAbsolute, join, resolve } from 'node:path'
import { runProcess } from '../../../src/shared/child-process/run-process'

// This is the extension's only runtime import from Orca: its cross-platform process boundary.
export async function resolveOrcaExecutable(
  input: string,
  env: NodeJS.ProcessEnv = process.env
): Promise<string> {
  const candidates =
    isAbsolute(input) || input.includes('/') || input.includes('\\')
      ? [resolve(input)]
      : (env.PATH ?? '').split(delimiter).flatMap((directory) => {
          const extensions =
            process.platform === 'win32' && !extname(input)
              ? ['', ...(env.PATHEXT ?? '.EXE;.CMD;.BAT').split(';')]
              : ['']
          return extensions.map((extension) => join(directory, `${input}${extension}`))
        })
  for (const candidate of candidates) {
    try {
      await access(
        candidate,
        process.platform === 'win32' || /\.[cm]?js$/i.test(candidate)
          ? constants.R_OK
          : constants.X_OK
      )
      return candidate
    } catch {
      /* Try the next PATH entry. */
    }
  }
  throw new Error(
    `Cannot find the Orca CLI: ${input}. Install it or pass --orca /absolute/path/to/orca.`
  )
}

export class OrcaCommandError extends Error {
  constructor(
    message: string,
    readonly receipt: unknown
  ) {
    super(message)
  }
}

export type OrcaCall = (args: string[], timeoutMs?: number) => Promise<unknown>

export function createOrcaCall(executable: string, cwd: string): OrcaCall {
  return async (args, timeoutMs = 75_000) => {
    const script = /\.[cm]?js$/i.test(executable)
    const result = await runProcess({
      program: script ? process.execPath : executable,
      args: [...(script ? [executable] : []), ...args, '--json'],
      cwd,
      env: { ...process.env, ORCA_BACKGROUND_LAUNCH: '1' },
      timeoutMs,
      maxOutputBytes: 1024 * 1024
    })
    if (result.timedOut || result.outputTruncated) {
      throw new OrcaCommandError(
        'Orca response is unverifiable; do not automatically repeat a mutation.',
        { timedOut: result.timedOut, outputTruncated: result.outputTruncated }
      )
    }
    let receipt: unknown
    try {
      receipt = JSON.parse(result.stdout)
    } catch {
      throw new OrcaCommandError(
        'Orca did not return a JSON receipt. Inspect the command before retrying.',
        { stderr: result.stderr, exitCode: result.code }
      )
    }
    if (
      result.code !== 0 ||
      !receipt ||
      typeof receipt !== 'object' ||
      !('ok' in receipt) ||
      receipt.ok !== true ||
      !('result' in receipt)
    ) {
      throw new OrcaCommandError(
        'Orca refused the command or could not verify its result; inspect the saved receipt.',
        receipt
      )
    }
    return receipt.result
  }
}
