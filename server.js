const WebSocket = require('ws');
const child_process = require('child_process');
const fs = require('fs');

const wss = new WebSocket.Server({ port: 8080 });
const clients = [];

wss.on('connection', function connection(ws) {

  console.log("Connection")

  ws.on('message', function incoming(message) {
    message = JSON.parse(message)
    console.log('received: %s', message);

    const type = message.type;
    const clientUUID = message.source; //rendere sicuro

    switch (type) {
      case "start":
        console.log("Spawning process for client", clientUUID)
        startProcess(message)
        break;
      case "announce":
        console.log("New client announced itself:", clientUUID)
        clients[clientUUID] = ws;
        break;
      case "csv":
        console.log(`Client ${clientUUID} uploaded a CSV file [${message.plname}]`);
        createDirectory(`clients/${clientUUID}/csv/`, ()=>{
          fs.writeFileSync(`clients/${clientUUID}/csv/${message.plname}.csv`, message.content);
        });
        break;
      default:
        console.log("Unknown command", type)
    }

  });

});

async function createDirectory(dirPath, cb) {
  try {
    const dirExists = await fs.promises.access(dirPath).then(() => true).catch(() => false);
    if (dirExists) { cb(); return};

    await fs.promises.mkdir(dirPath, { recursive: true });
    console.log(`Directory created: ${dirPath}`);
    cb();
  } catch (error) {
    console.error(`Error creating directory: ${error.message}`);
  }
}

function startProcess(message) {

  const cmd = `node index.js "${message.source}" "${message.plname}"`;
  console.log(cmd)
  const process = child_process.exec(cmd); // Correctly split command and arguments
  let socket = clients[message.source]

  process.stdout.on('data', (data) => {
    console.log(data)
    socket.send(JSON.stringify({
      type: "log",
      data: data.toString()
    }));
  });

  process.stderr.on('data', (data) => {
    socket.send(JSON.stringify({
      type: "error",
      data: data.toString()
    }));
  });

  process.on('close', (code) => {
    socket.send(JSON.stringify({
      type: "close",
      data: `Process exited with code ${code}`
    }));
  });

  process.on('error', (err) => {
    socket.send(JSON.stringify({
      type: "error",
      data: `Failed to start process: ${err.message}`
    }));
  });

}