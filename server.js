const WebSocket = require('ws');
const { spawn } = require('child_process');
const fs = require('fs');

const wss = new WebSocket.Server({ port: 8080 });
const clients = [];
const processes = [];
let playlistName;

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
      case "stop":
        const PID = processes[message.source];
        if (PID) {
          console.log("Terminating PID", PID.pid);
          PID.kill('SIGKILL');
          delete processes[message.source];  // Rimuovi il processo da `processes`
        }
        clients[message.source].send(JSON.stringify({
          type: "log",
          data: "Process killed :("
        }));
        break;
      case "csv":
        playlistName = message.plname;
        console.log(`Client ${clientUUID} uploaded a CSV file [${playlistName}]`);
        createDirectory(`clients/${clientUUID}/csv/`, () => {
          fs.writeFileSync(`clients/${clientUUID}/csv/${playlistName}.csv`, message.content);
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
    if (dirExists) { cb(); return };

    await fs.promises.mkdir(dirPath, { recursive: true });
    console.log(`Directory created: ${dirPath}`);
    cb();
  } catch (error) {
    console.error(`Error creating directory: ${error.message}`);
  }
}

function startProcess(message) {
  const cmd = 'node';
  const args = ['index.js', message.source, message.plname];  // Passaggio sicuro degli argomenti
  
  const child = spawn(cmd, args);

  let socket = clients[message.source];

  // Gestire stdout
  child.stdout.on('data', (data) => {
    console.log(data.toString());
    socket.send(JSON.stringify({
      type: "log",
      data: data.toString()
    }));
  });

  // Gestire stderr
  child.stderr.on('data', (data) => {
    socket.send(JSON.stringify({
      type: "error",
      data: data.toString()
    }));
  });

  // Quando il processo termina
  child.on('close', (code) => {
    console.log(`Process closed with code: ${code}`);
    socket.send(JSON.stringify({
      type: "end",
      plname: playlistName
    }));
  });

  // Gestire errori
  child.on('error', (err) => {
    console.error(`Process error: ${err.message}`);
    socket.send(JSON.stringify({
      type: "error",
      data: `Failed to start process: ${err.message}`
    }));
  });

  // Salvare il processo in processes
  processes[message.source] = child;
}

function stopProcess(clientUUID) {
  const child = processes[clientUUID];
  if (child) {
    console.log("Terminating process with PID:", child.pid);
    child.kill('SIGKILL'); // Assicurati che il processo venga terminato
    delete processes[clientUUID];  // Rimuovi il processo da `processes`
    clients[clientUUID].send(JSON.stringify({
      type: "log",
      data: "Process killed :("
    }));
  } else {
    console.log("No process found for client", clientUUID);
  }
}