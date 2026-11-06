const noisy = [
    'Closing session:',
    'Opening session:',
    'Removing old closed session:',
    'Session already closed',
    'Session already open',
    // libsignal prints these straight to the console, bypassing the baileys
    // logger. A busy account emits hundreds per hour (one per renegotiated
    // session), and pm2 writes every one into the error log.
    'Closing open session in favor of incoming prekey bundle',
    'Closing session in favor of incoming prekey bundle',
    'No session to close',
    'Session error:',
]

const info = console.info.bind(console)
const warn = console.warn.bind(console)
const log = console.log.bind(console)

const isNoisy = (args: unknown[]): boolean => {
    const first = args[0]
    return typeof first === 'string' && noisy.some((prefix) => first.startsWith(prefix))
}

console.info = (...args: unknown[]): void => {
    if (!isNoisy(args)) info(...args)
}

console.warn = (...args: unknown[]): void => {
    if (!isNoisy(args)) warn(...args)
}

console.log = (...args: unknown[]): void => {
    if (!isNoisy(args)) log(...args)
}
