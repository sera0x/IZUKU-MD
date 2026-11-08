

export function boldLine(line: string): string {
    const m = line.match(/^(\s*)(.*?)(\s*)$/s)
    const lead = m?.[1] ?? ''
    const core = m?.[2] ?? line
    const trail = m?.[3] ?? ''
    if (!core || core.includes('*') || /^[\s\p{P}\p{S}]*$/u.test(core)) return line
    return lead + '*' + core + '*' + trail
}

export function boldText(text: string): string {
    return text.split('\n').map(boldLine).join('\n')
}

export function isMarkerLog(text: string): boolean {
    return /^\s*\[(image|audio)\]/i.test(text)
}

export function isStartupBroadcast(text: string): boolean {
    return /^\*[^*\n]+\* is online ✅/.test(text.trimStart())
}
