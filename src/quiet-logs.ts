const noisy = [
    'Closing session:',
    'Opening session:',
    'Removing old closed session:',
    'Session already closed',
    'Session already open',
]

const info = console.info.bind(console)
const warn = console.warn.bind(console)

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
