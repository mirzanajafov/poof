process.on('message', (message) => process.send!(message))
process.send!('ready')
