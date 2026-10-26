if (!process.send) throw new Error('b4-child runs only as a child process with an IPC channel')
const send = process.send.bind(process)
process.on('message', (message) => send(message))
send('ready')
