import { execFile } from 'node:child_process'
import { promisify } from 'node:util'
import type { WASocket } from 'baileys'
import { config } from '../config.ts'
import { db } from '../db/index.js'
import { createLogger } from '../logger.js'
import { selfChatJid } from './helpers.js'

const exec = promisify(execFile)
const log = createLogger(config.logLevel, { scope: 'update' })

/** Last commit sha the owner was told about, so a notice is sent only once. */
const NOTIFIED_KEY = 'UPDATE_NOTIFIED_SHA'

export interface UpdateStatus {
    checked: boolean
    available: boolean
    localSha: string
    remoteSha: string
    summary: string
    error?: string
}

function repoSlug(): { owner: string; name: string } {
    const match = /github\.com\/([^/]+)\/([^/#?]+)/i.exec(config.links.repo)
    const owner = match?.[1] ?? 'sera0x'
    const name = (match?.[2] ?? 'IZUKU-MD').replace(/\.git$/, '')
    return { owner, name }
}

async function git(args: string[]): Promise<string> {
    const { stdout } = await exec('git', args, {
        cwd: process.cwd(),
        timeout: 25_000,
        maxBuffer: 4 * 1024 * 1024,
    })
    return stdout.trim()
}

export async function localSha(): Promise<string> {
    try {
        return await git(['rev-parse', 'HEAD'])
    } catch {
        return ''
    }
}

/**
 * Compare the running checkout with the newest commit on GitHub. A commit that
 * is already an ancestor of HEAD is not an update, so a local merge or extra
 * commits do not produce a false notice.
 */
export async function checkForUpdate(): Promise<UpdateStatus> {
    const status: UpdateStatus = { checked: false, available: false, localSha: '', remoteSha: '', summary: '' }
    try {
        const local = await localSha()
        status.localSha = local
        if (!local) {
            status.error = 'not a git checkout'
            return status
        }

        const { owner, name } = repoSlug()
        const response = await fetch(`https://api.github.com/repos/${owner}/${name}/commits?per_page=1`, {
            headers: { accept: 'application/vnd.github+json', 'user-agent': `${config.botName}-update-check` },
            signal: AbortSignal.timeout(15_000),
        })
        if (!response.ok) {
            status.error = `github answered ${response.status}`
            return status
        }

        const rows = (await response.json()) as Array<{ sha?: string; commit?: { message?: string } }>
        const top = Array.isArray(rows) ? rows[0] : undefined
        const remote = typeof top?.sha === 'string' ? top.sha : ''
        if (!remote) {
            status.error = 'empty commit list'
            return status
        }

        status.checked = true
        status.remoteSha = remote
        status.summary = (top?.commit?.message ?? '').split('\n')[0]?.trim() ?? ''
        if (remote === local) return status

        try {
            await exec('git', ['merge-base', '--is-ancestor', remote, 'HEAD'], {
                cwd: process.cwd(),
                timeout: 25_000,
            })
            status.available = false
        } catch {
            status.available = true
        }
        return status
    } catch (error) {
        status.error = (error as Error).message
        return status
    }
}

export function updateNotice(status: UpdateStatus): string {
    return [
        '🆕 *Update available*',
        '',
        `▸ ${config.botName} has a newer build on GitHub`,
        status.summary ? `▸ Latest: ${status.summary.slice(0, 100)}` : '',
        `▸ Running: ${status.localSha.slice(0, 7)} → newest: ${status.remoteSha.slice(0, 7)}`,
        '',
        `▸ Send *${config.prefix}update* and reply *yes* to install and restart`,
    ]
        .filter(Boolean)
        .join('\n')
}

export interface UpdateRun {
    ok: boolean
    output: string
}

async function step(command: string, args: string[]): Promise<{ ok: boolean; output: string }> {
    try {
        const { stdout, stderr } = await exec(command, args, {
            cwd: process.cwd(),
            timeout: 10 * 60_000,
            maxBuffer: 8 * 1024 * 1024,
        })
        return { ok: true, output: `${stdout}\n${stderr}`.trim() }
    } catch (error) {
        const detail = error as NodeJS.ErrnoException & { stdout?: string; stderr?: string }
        return { ok: false, output: `${detail.stdout ?? ''}\n${detail.stderr ?? ''}\n${detail.message ?? ''}`.trim() }
    }
}

/** Pull, install and rebuild. The caller restarts the bot when this succeeds. */
export async function applyUpdate(): Promise<UpdateRun> {
    const logLines: string[] = []

    // Deployments usually carry local edits: a hand-applied patch, a config
    // tweak made in place. `git pull --ff-only` refuses to touch any of them
    // and aborts the whole update, so move them aside first and put them back
    // afterwards instead of making the owner clean the tree by hand.
    const status = await step('git', ['status', '--porcelain'])
    const dirty = status.ok && status.output.trim().length > 0
    if (dirty) {
        const stash = await step('git', ['stash', 'push', '--include-untracked', '-m', `izuku-update-${Date.now()}`])
        logLines.push(`$ git stash push --include-untracked\n${stash.output.slice(-400)}`)
        if (!stash.ok) return { ok: false, output: logLines.join('\n\n') }
    }

    const pull = await step('git', ['pull', '--ff-only'])
    logLines.push(`$ git pull\n${pull.output.slice(-600)}`)
    if (!pull.ok) {
        if (dirty) {
            const back = await step('git', ['stash', 'pop'])
            logLines.push(`$ git stash pop\n${back.output.slice(-400)}`)
        }
        return { ok: false, output: logLines.join('\n\n') }
    }

    if (dirty) {
        const pop = await step('git', ['stash', 'pop'])
        logLines.push(`$ git stash pop\n${pop.output.slice(-600)}`)
        if (!pop.ok) {
            // The pulled build already contains these edits, or they conflict
            // with it. Clear the half-merged working tree and leave the stash in
            // place so nothing the owner wrote is ever thrown away.
            await step('git', ['checkout', '--', '.'])
            logLines.push('Local edits were kept in a stash — reapply with `git stash pop`.')
        }
    }

    const install = await step('npm', ['install', '--no-audit', '--no-fund'])
    logLines.push(`$ npm install\n${install.output.slice(-900)}`)
    if (!install.ok) return { ok: false, output: logLines.join('\n\n') }

    const build = await step('npm', ['run', 'build'])
    logLines.push(`$ npm run build\n${build.output.slice(-900)}`)
    if (!build.ok) return { ok: false, output: logLines.join('\n\n') }

    return { ok: true, output: logLines.join('\n\n') }
}

/**
 * Tell the owner about a newer commit — once per commit, so a restart does not
 * repeat the notice. The groups are never told: the update belongs to whoever
 * runs the bot.
 */
export async function announceUpdate(sock: WASocket): Promise<void> {
    const status = await checkForUpdate()
    if (!status.available) {
        log.debug('update check: %s', status.error ?? 'up to date')
        return
    }

    const notice = updateNotice(status)
    if ((db.settingValue(NOTIFIED_KEY) ?? '') === status.remoteSha) return

    const target =
        selfChatJid(sock) || (config.anchorNumber ? `${config.anchorNumber}@s.whatsapp.net` : '')
    if (target) {
        await sock
            .sendMessage(target, { text: notice })
            .catch((error: Error) => log.debug('update notice failed: %s', error.message))
    }

    db.setSetting(NOTIFIED_KEY, status.remoteSha)
    log.info('update available: %s', status.remoteSha.slice(0, 7))
}
