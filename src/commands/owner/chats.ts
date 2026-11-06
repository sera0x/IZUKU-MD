import { ari } from '../../bot/registry.js'

const appStateAction = (
    name: string,
    description: string,
    aliases: string[],
    apply: 'pin' | 'unpin' | 'archive' | 'unarchive' | 'clear',
    confirm: string,
) =>
    ari({
        name,
        description,
        category: 'owner',
        aliases,
        ownerOnly: true,
        groupOnly: false,
        run: async (ctx) => {
            switch (apply) {
                case 'pin':
                case 'unpin':
                    await ctx.sock.chatModify({ pin: apply === 'pin' }, ctx.chat)
                    break
                case 'archive':
                case 'unarchive':
                    await ctx.sock.chatModify(
                        { archive: apply === 'archive', lastMessages: [] },
                        ctx.chat,
                    )
                    break
                case 'clear':
                    await ctx.sock.chatModify({ clear: true, lastMessages: [ctx.msg] }, ctx.chat)
                    break
            }
            await ctx.reply(confirm)
        },
    })

appStateAction('pin', 'Pin this chat', ['chatpin'], 'pin', '*Chat pinned.*')
appStateAction('unpin', 'Unpin this chat', ['chatunpin'], 'unpin', '*Chat unpinned.*')
appStateAction('archive', 'Archive this chat', ['chatarchive'], 'archive', '*Chat archived.*')
appStateAction('unarchive', 'Unarchive this chat', ['chatunarchive'], 'unarchive', '*Chat unarchived.*')
appStateAction('clear', 'Clear this chat on the bot account', ['clearchat'], 'clear', '*Chat cleared.*')
