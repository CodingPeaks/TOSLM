const WebSocket = require('ws');
const child_process = require('child_process');

const wss = new WebSocket.Server({ port: 8080 });

wss.on('connection', function connection(ws) {

  console.log("Connection")

  ws.on('message', function incoming(message) {
    message = JSON.parse(message)
    console.log('received: %s', message);
    const type = message.type;
    const clientUUID = message.source; //rendere sicuro

    if (type == 'start') {
      const playlistName = message.plname; //rendere sicuro

      console.log("Spawning process")
      const process = child_process.exec(`node index.js "${clientUUID}" "${playlistName}"`); // Correctly split command and arguments

      process.stdout.on('data', (data) => {
        console.log(data)
        ws.send(JSON.stringify({
          type: "log",
          data: data.toString()
        }));
      });

      process.stderr.on('data', (data) => {
        ws.send(JSON.stringify({
          type: "error",
          data: data.toString()
        }));
      });

      process.on('close', (code) => {
        ws.send(JSON.stringify({
          type: "close",
          data: `Process exited with code ${code}`
        }));
      });

      process.on('error', (err) => {
        ws.send(JSON.stringify({
          type: "error",
          data: `Failed to start process: ${err.message}`
        }));
      });
    }
  });

});