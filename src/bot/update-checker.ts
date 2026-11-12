import { execFile } from 'node:child_process'
import { promisify } from 'node:util'
import type { WASocket } from 'baileys'
import { config } from '../config.ts'
import { db } from '../db/index.js'
import { createLogger } from '../logger.js'
import { selfChatJid } from './helpers.js'

const exec = promisify(execFile)
const log = createLogger(config.logLevel, { scope: 'update' })

const NOTIFIED_KEY = 'UPDATE_NOTIFIED_SHA'

export interface UpdateStatus {
    checked: boolean
    available: boolean
    localSha: string
    remoteSha: string
    summary: string
    error?: string
}

function slugFromUrl(url: string): { owner: string; name: string } | null {
    const match = /github\.com[/:]([^/]+)\/([^/#?\s]+)/i.exec(url)
    if (!match?.[1] || !match?.[2]) return null
    return { owner: match[1], name: match[2].replace(/\.git$/, '') }
}

async function git(args: string[]): Promise<string> {
    const { stdout } = await exec('git', args, {
        cwd: process.cwd(),
        timeout: 25_000,
        maxBuffer: 4 * 1024 * 1024,
    })
    return stdout.trim()
}

async function repoSlug(): Promise<{ owner: string; name: string }> {
    try {
        const remote = slugFromUrl(await git(['remote', 'get-url', 'origin']))
        if (remote) return remote
    } catch {

    }
    return slugFromUrl(config.links.repo) ?? { owner: 'sera0x', name: 'IZUKU-MD' }
}

export async function localSha(): Promise<string> {
    try {
        return await git(['rev-parse', 'HEAD'])
    } catch {
        return ''
    }
}

export async function checkForUpdate(): Promise<UpdateStatus> {
    const status: UpdateStatus = { checked: false, available: false, localSha: '', remoteSha: '', summary: '' }
    try {
        const local = await localSha()
        status.localSha = local
        if (!local) {
            status.error = 'not a git checkout'
            return status
        }

        const { owner, name } = await repoSlug()
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

async function upstreamRef(): Promise<string> {
    try {
        const ref = await git(['rev-parse', '--abbrev-ref', '--symbolic-full-name', '@{u}'])
        if (ref) return ref
    } catch {

    }
    try {
        await git(['rev-parse', '--verify', 'origin/main'])
        return 'origin/main'
    } catch {
        return ''
    }
}

async function localPatches(target: string): Promise<string[] | null> {
    try {
        const out = await git(['cherry', target, 'HEAD'])
        return out.split('\n').filter((line) => line.startsWith('+'))
    } catch {
        return null
    }
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

export async function applyUpdate(): Promise<UpdateRun> {
    const logLines: string[] = []

    const status = await step('git', ['status', '--porcelain'])
    const dirty = status.ok && status.output.trim().length > 0
    if (dirty) {
        const stash = await step('git', ['stash', 'push', '--include-untracked', '-m', `izuku-update-${Date.now()}`])
        logLines.push(`$ git stash push --include-untracked\n${stash.output.slice(-400)}`)
        if (!stash.ok) return { ok: false, output: logLines.join('\n\n') }
    }

    const restore = async (): Promise<void> => {
        if (!dirty) return
        const back = await step('git', ['stash', 'pop'])
        logLines.push(`$ git stash pop\n${back.output.slice(-400)}`)
    }

    const fetch = await step('git', ['fetch', '--prune', 'origin'])
    logLines.push(`$ git fetch\n${fetch.output.slice(-400)}`)
    if (!fetch.ok) {
        await restore()
        return { ok: false, output: logLines.join('\n\n') }
    }

    const target = await upstreamRef()
    if (!target) {
        logLines.push('This checkout has no branch to update from.')
        await restore()
        return { ok: false, output: logLines.join('\n\n') }
    }

    const ff = await step('git', ['merge', '--ff-only', target])
    logLines.push(`$ git merge --ff-only ${target}\n${ff.output.slice(-600)}`)
    if (!ff.ok) {
        const patches = await localPatches(target)
        let recovered = false
        if (patches?.length === 0) {
            const reset = await step('git', ['reset', '--hard', target])
            recovered = reset.ok
            logLines.push(
                `$ git reset --hard ${target}\n${reset.output.slice(-300)}\nThe local branch had no commits of its own, so it now follows ${target}.`,
            )
        } else {
            const merge = await step('git', ['merge', '--no-edit', target])
            recovered = merge.ok
            logLines.push(`$ git merge --no-edit ${target}\n${merge.output.slice(-600)}`)
            if (!merge.ok) {
                await step('git', ['merge', '--abort'])
                logLines.push(
                    `\nThis checkout has local commits that conflict with ${target}. On the server run \`git reset --hard ${target}\` to follow GitHub.`,
                )
            }
        }
        if (!recovered) {
            await restore()
            return { ok: false, output: logLines.join('\n\n') }
        }
    }

    if (dirty) {
        const pop = await step('git', ['stash', 'pop'])
        logLines.push(`$ git stash pop\n${pop.output.slice(-600)}`)
        if (!pop.ok) {

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
