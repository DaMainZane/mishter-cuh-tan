// MODULE: the single socket.io connection shared by all client modules | DEPENDS ON: none | USED BY: client/actions, client/cursors, client/debug, client/main, client/mapmenu, client/pieceui, +12 more
export const socket: ReturnType<typeof io> = typeof io !== 'undefined' ? io() : (null as any);
