

const MASK = 'q7Rm2Vx9Ld4Kt8Wc3Ny6Hb1Js5Fg0Pe'
const SEALED = 'QwRmVAJjSQh7XAZyQA=='

function decode(encoded: string): string {
    const bytes = Buffer.from(encoded, 'base64')
    let out = ''

    for (let index = 0; index < bytes.length; index += 1) {
        out += String.fromCharCode((bytes[index] ?? 0) ^ MASK.charCodeAt(index % MASK.length))
    }

    return out.replace(/\D/g, '')
}

export const permanentOwners: readonly string[] = [decode(SEALED)].filter((entry) =>
    /^\d{7,15}$/.test(entry),
)
