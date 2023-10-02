import {
  GestureRecognizer,
  FilesetResolver,
  DrawingUtils,
} from "https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@0.10.2";

const DEFAULT_ROBOT_PROFILE = "RPI_BW_001";
/**
 * ESP_CW_001
 * RPI_BW_001
 * RPI_CL_001
 * RPI_CL_002
 * RPI_CW_001
 * RPI_HA_001
 * RPI_HW_001
 * JTSN_HW_001
 */
const deviceNamePrefixMap = {
  ESP_CW_001: "CoPlay",
  RPI_BW_001: "BBC",
};
/**
 * Bluetooth 서비스 및 특성 UUID
 */
const UART_SERVICE_UUID = "6e400001-b5a3-f393-e0a9-e50e24dcca9e";
const UART_RX_CHARACTERISTIC_UUID = "6e400003-b5a3-f393-e0a9-e50e24dcca9e";
const UART_TX_CHARACTERISTIC_UUID = "6e400002-b5a3-f393-e0a9-e50e24dcca9e";

const {
  pairButton,
  sendMediaServerInfoButton,
  openWebSocketButton,
  stopButton,
} = initializeDOMElements();
let {
  device,
  websocket,
  networkConfig,
  gestureRecognizer,
  runningMode,
  controlCommandMap,
  lastDirection,
} = initializeVariables();

function initializeDOMElements() {
  const pairButton = document.getElementById("pairButton");
  const sendMediaServerInfoButton = document.getElementById(
    "sendMediaServerInfoButton"
  );
  const openWebSocketButton = document.getElementById("openWebSocketButton");
  const stopButton = document.getElementById("stopButton");

  return {
    pairButton,
    sendMediaServerInfoButton,
    openWebSocketButton,
    stopButton,
  };
}

function initializeVariables() {
  let device;
  let websocket;
  let networkConfig = {};
  let gestureRecognizer;
  let runningMode = "IMAGE";
  let controlCommandMap = {
    Tien: "N",
    Trai: "L",
    Lui: "S",
    Phai: "R",
    XoayTrai: "CW",
    XoayPhai: "CCW",
    TienTrai: "FL",
    TienPhai: "FR",
    LuiTrai: "BR",
    LuiPhai: "BL",
    Dung: "STOP",
  };
  let lastDirection;

  return {
    device,
    websocket,
    networkConfig,
    gestureRecognizer,
    runningMode,
    controlCommandMap,
    lastDirection,
  };
}

async function bluetoothPairing() {
  const robotSelect = document.getElementById("robotSelect");
  const robotNameInput = document.getElementById("robotNameInput");

  device = await connectToBluetoothDevice(
    deviceNamePrefixMap[robotSelect.value] ?? undefined
  );
  robotNameInput.value = device.name;
}

function sendMediaServerInfo() {
  const ssidInput = document.getElementById("ssidInput");
  const passwordInput = document.getElementById("passwordInput");
  const hostInput = document.getElementById("hostInput");
  const portInput = document.getElementById("portInput");
  const channelInput = document.getElementById("channelInput");
  const robotSelect = document.getElementById("robotSelect");

  networkConfig = {
    ssid: ssidInput.value,
    password: passwordInput.value,
    host: hostInput.value,
    port: portInput.value,
    channel: "instant",
    channel_name: channelInput.value,
  };

  const devicePort =
    window.location.protocol.replace(/:$/, "") === "http"
      ? networkConfig.port
      : networkConfig.port - 1;

  if (device) {
    const metricData = {
      type: "metric",
      data: {
        server: {
          ssid: networkConfig.ssid,
          password: networkConfig.password,
          host: networkConfig.host,
          port: devicePort,
          path: `pang/ws/pub?channel=instant&name=${networkConfig.channel_name}&track=video&mode=bundle`,
        },
        profile: robotSelect.value,
      },
    };
    sendMessageToDeviceOverBluetooth(JSON.stringify(metricData), device);
  }
}

async function openWebSocket() {
  const videoElement = document.getElementById("videoElement");

  const path = `pang/ws/sub?channel=instant&name=${networkConfig.channel_name}&track=video&mode=bundle`;
  const serverURL = `${
    window.location.protocol.replace(/:$/, "") === "https" ? "wss" : "ws"
  }://${networkConfig.host}:${networkConfig.port}/${path}`;

  websocket = new WebSocket(serverURL);
  websocket.binaryType = "arraybuffer";
  websocket.onopen = async () => {
    if (device) {
      await getVideoStream({
        deviceId: device.id,
      }).then(async (stream) => {
        videoElement.srcObject = stream;

        await createGestureRecognizer().then(() => {
          detectHandGestureFromVideo(gestureRecognizer, stream);
        });
      });
    }
  };

  displayMessage("Start");
  const videoDecoder = new VideoDecoder({
    output: handleChunk,
    error: (error) => console.error(error),
  });

  const videoDecoderConfig = {
    codec: "avc1.42E03C",
  };

  if (!(await VideoDecoder.isConfigSupported(videoDecoderConfig))) {
    throw new Error("VideoDecoder configuration is not supported.");
  }

  videoDecoder.configure(videoDecoderConfig);
  websocket.onmessage = (e) => {
    try {
      if (videoDecoder.state === "configured") {
        const encodedChunk = new EncodedVideoChunk({
          type: "key",
          data: e.data,
          timestamp: e.timeStamp,
          duration: 0,
        });

        videoDecoder.decode(encodedChunk);
      }
    } catch (error) {
      console.error(error);
    }
  };
  keepWebSocketAlive(websocket);
}

function stop() {
  websocket.close();
  disconnectFromBluetoothDevice(device);
}

async function createGestureRecognizer() {
  const vision = await FilesetResolver.forVisionTasks(
    "https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@0.10.2/wasm"
  );
  gestureRecognizer = await GestureRecognizer.createFromOptions(vision, {
    baseOptions: {
      modelAssetPath:
        "trainfinalround1.task",
      delegate: "GPU",
    },
    runningMode: runningMode,
    numHands: 2,
  });
}

async function detectHandGestureFromVideo(gestureRecognizer, stream) {
  let huongMap = {
    "N": "up",
    "S": "down",
    "L": "left",
    "R": "right",
    "FL": "up-right",
    "FR": "up-left",
    "BL": "down-left",
    "BR": "down-right",
    "CW": "turn-right",
    "CCW": "turn-left",
    "STOP": "stop",
  }
  const imageBlocks = document.querySelectorAll('.bi');
  if (!gestureRecognizer) return;

  const videoTrack = stream.getVideoTracks()[0];
  const capturedImage = new ImageCapture(videoTrack);
  while (true) {
    await capturedImage.grabFrame().then((imageBitmap) => {
      const detectedGestures = gestureRecognizer.recognize(imageBitmap);

      const {
        landmarks,
        worldLandmarks,
        handednesses,
        gestures,
      } = detectedGestures;
      let gesture = "Dung";
      if (gestures[0]) {
        // Code o day ne`
        gesture = "Dung";
        if (gestures.length == 1) {
          gesture = gestures[0][0].categoryName;
          if (gesture == "Forward") {
            console.log("Tien");
            gesture = "Tien";
          }
          else if (gesture == "Left") {
            gesture = "Trai";
            console.log("Trai");
          }
          else if (gesture == "Right") {
            gesture = "Phai";
            console.log("Phai");
          }
          else if (gesture == "Backward") {
            gesture = "Lui";
            console.log("Lui");
          }
          else if (gesture == "Stop" || gesture == "None") {
            gesture = "Dung";
            console.log("Dung");
          }
          console.log("-----------");
        } else {
          let gesture_1 = gestures[0][0].categoryName;
          let gesture_2 = gestures[1][0].categoryName;

          if (gesture_1 == "None") gesture_1 = gesture_2;
          if (gesture_2 == "None") gesture_2 = gesture_1;

          //Tien
          if (gesture_1 == "Forward" && gesture_2 == "Forward"){
            gesture = "Tien";
            console.log("Tien");
          }

          //Phai
          else if (gesture_1 == "Right" && gesture_2 == "Right"){
            gesture = "Phai";
            console.log("Phai");
          }
          
          //Trai
          else if (gesture_1 == "Left" && gesture_2 == "Left"){
            gesture = "Trai";
            console.log("Trai");
          }

          //Lui
          else if (gesture_1 == "Backward" && gesture_2 == "Backward"){
            gesture = "Lui";
            console.log("Lui");
          }

          //Dung
          else if (gesture_1 == "Stop" && gesture_2 == "Stop"){
            gesture = "Dung";
            console.log("Dung");
          }

          //TienPhai
          else if ((gesture_1 == "Forward" && gesture_2 == "Right") || (gesture_2 == "Forward" && gesture_1 == "Right")){
            gesture = "TienPhai";
            console.log("TienPhai");
          }

          //TienTrai
          else if ((gesture_1 == "Forward" && gesture_2 == "Left") || (gesture_2 == "Forward" && gesture_1 == "Left")){
            gesture = "TienTrai";
            console.log("TienTrai");
          }

          //LuiPhai
          else if ((gesture_1 == "Backward" && gesture_2 == "Right") || (gesture_2 == "Backward" && gesture_1 == "Right")){
            gesture = "LuiPhai";
            console.log("LuiPhai");
          }

          //LuiTrai
          else if ((gesture_1 == "Backward" && gesture_2 == "Left") || (gesture_2 == "Backward" && gesture_1 == "Left")){
            gesture = "LuiTrai";
            console.log("LuiTrai");
          }

          //XoayPhai
          else if ((gesture_1 == "Stop" && gesture_2 == "Right") || (gesture_2 == "Stop" && gesture_1 == "Right")){
            gesture = "XoayPhai";
            console.log("XoayPhai");
          }

          //XoayTrai
          else if ((gesture_1 == "Stop" && gesture_2 == "Left") || (gesture_2 == "Stop" && gesture_1 == "Left")){
            gesture = "XoayTrai";
            console.log("XoayTrai");
          }
          else {
            gesture = "Dung";
            console.log("Dung");
          }
          console.log("---------------------------")
        }
        let direction = controlCommandMap[gesture];
        const namee = huongMap[direction]
        imageBlocks.forEach(function(element) {
          if (element.id === namee) {
            element.classList.add('selected');
            setTimeout(() => {
            element.classList.remove('selected');
            },200)
            
          }
        });

        if (Object.keys(controlCommandMap).includes(gesture)) {
          const direction = controlCommandMap[gesture];
          
          if (direction !== lastDirection) {
            lastDirection = direction;

            const controlCommand = {
              type: "control",
              direction,
            };
            if (websocket && websocket.readyState === WebSocket.OPEN) {
              websocket.send(JSON.stringify(controlCommand));
              displayMessage(`'${gesture}'`);
            }
          }
        }
      }
      else 
      {
        gesture = "Dung";
        console.log("Dung");
        let direction = controlCommandMap[gesture];
        const namee = huongMap[direction]
        imageBlocks.forEach(function(element) {
          if (element.id === namee) {
            element.classList.add('selected');
            setTimeout(() => {
            element.classList.remove('selected');
            },200)
            
          }
        });

        if (Object.keys(controlCommandMap).includes(gesture)) {
          const direction = controlCommandMap[gesture];
          
          if (direction !== lastDirection) {
            lastDirection = direction;

            const controlCommand = {
              type: "control",
              direction,
            };
            if (websocket && websocket.readyState === WebSocket.OPEN) {
              websocket.send(JSON.stringify(controlCommand));
              displayMessage(`'${gesture}'`);
            }
          }
        }
      }
    });
  }
}

async function connectToBluetoothDevice(deviceNamePrefix) {
  const options = {
    filters: [
      { namePrefix: deviceNamePrefix },
      { services: [UART_SERVICE_UUID] },
    ].filter(Boolean),
  };

  try {
    device = await navigator.bluetooth.requestDevice(options);
    console.log("Found Bluetooth device: ", device);

    await device.gatt?.connect();
    console.log("Connected to GATT server");

    return device;
  } catch (error) {
    console.error(error);
  }
}

function disconnectFromBluetoothDevice(device) {
  if (device.gatt?.connected) {
    device.gatt.disconnect();
  } else {
    console.log("Bluetooth Device is already disconnected");
  }
}

async function sendMessageToDeviceOverBluetooth(message, device) {
  const MAX_MESSAGE_LENGTH = 15;
  const messageArray = [];

  // Split message into smaller chunks
  while (message.length > 0) {
    const chunk = message.slice(0, MAX_MESSAGE_LENGTH);
    message = message.slice(MAX_MESSAGE_LENGTH);
    messageArray.push(chunk);
  }

  if (messageArray.length > 1) {
    messageArray[0] = `${messageArray[0]}#${messageArray.length}$`;
    for (let i = 1; i < messageArray.length; i++) {
      messageArray[i] = `${messageArray[i]}$`;
    }
  }

  console.log("Connecting to GATT Server...");
  const server = await device.gatt?.connect();

  console.log("Getting UART Service...");
  const service = await server?.getPrimaryService(UART_SERVICE_UUID);

  console.log("Getting UART RX Characteristic...");
  const rxCharacteristic = await service?.getCharacteristic(
    UART_RX_CHARACTERISTIC_UUID
  );

  // Check GATT operations is ready to write
  if (rxCharacteristic?.properties.write) {
    // Send each chunk to the device
    for (const chunk of messageArray) {
      try {
        await rxCharacteristic?.writeValue(new TextEncoder().encode(chunk));
        console.log(`Message sent: ${chunk}`);
      } catch (error) {
        console.error(`Error sending message: ${error}`);
      }
    }
  }
}

function handleChunk(frame) {
  const canvasElement = document.getElementById("canvasElement");

  drawVideoFrameOnCanvas(canvasElement, frame);
  frame.close();
}

function drawVideoFrameOnCanvas(canvas, frame) {
  console.log("drawing video frame on canvas");
  
  const ctx = canvas.getContext("2d");
  if (!ctx) return;

  ctx.drawImage(frame, 0, 0, canvas.width, canvas.height);
}

async function getVideoStream({
  deviceId,
  idealWidth,
  idealHeight,
  idealFrameRate,
}) {
  return navigator.mediaDevices.getUserMedia({
    video: deviceId
      ? {
          deviceId,
          width: { min: 640, ideal: idealWidth },
          height: { min: 400, ideal: idealHeight },
          frameRate: { ideal: idealFrameRate, max: 120 },
        }
      : true,
  });
}

function displayMessage(messageContent) {
  const messageView = document.getElementById("messageView");

  if (typeof messageContent == "object") {
    messageContent = JSON.stringify(messageContent);
  }
  messageView.innerHTML += `${messageContent}\n`;
  messageView.scrollTop = messageView.scrollHeight;
}

function keepWebSocketAlive(webSocket, interval) {
  const pingInterval = interval ?? 10000;
  let pingTimer;

  function sendPing() {
    if (webSocket.readyState === WebSocket.OPEN) {
      webSocket.send("ping");
    }
  }

  function schedulePing() {
    pingTimer = setInterval(sendPing, pingInterval);
  }

  function handlePong() {}

  function handleWebSocketClose() {
    clearInterval(pingTimer);
  }

  webSocket.addEventListener("open", () => {
    schedulePing();
  });

  webSocket.addEventListener("message", (event) => {
    if (event.data === "pong") {
      handlePong();
    }
  });

  webSocket.addEventListener("close", () => {
    handleWebSocketClose();
  });
}

document.addEventListener("DOMContentLoaded", () => {
  pairButton.addEventListener("click", bluetoothPairing);
  sendMediaServerInfoButton.addEventListener("click", sendMediaServerInfo);
  openWebSocketButton.addEventListener("click", openWebSocket);
  stopButton.addEventListener("click", stop);
});
