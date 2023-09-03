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
    Trai: "R",
    Lui: "S",
    Phai: "L",
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

  displayMessage("Open Video WebSocket");
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
        "https://storage.googleapis.com/mediapipe-models/gesture_recognizer/gesture_recognizer/float16/1/gesture_recognizer.task",
      delegate: "GPU",
    },
    runningMode: runningMode,
  });
}

async function detectHandGestureFromVideo(gestureRecognizer, stream) {
  let huongMap = {
    "N": "up",
    "S": "down",
    "W": "left",
    "E": "right",
    "NW": "up-left",
    "NE": "up-right",
    "SW": "down-left",
    "SE": "down-right",
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

      if (gestures[0]) {
        // Code o day ne`
        let gesture = "Dung";
        let direction = controlCommandMap[gesture];
        if (gestures.length == 1) {
          if (gestures[0][0].categoryName == "Pointing_Up") {
            console.log("Tien");
            gesture = "Tien";
          }
          if (gestures[0][0].categoryName == "Thumb_Left") {
            gesture = "Trai";
            console.log("Trai");
          }
          if (gestures[0][0].categoryName == "Thumb_Right") {
            gesture = "Phai";
            console.log("Phai");
          }
          if (gestures[0][0].categoryName == "Closed_Fist") {
            gesture = "Lui";
            console.log("Lui");
          }
          if (gestures[0][0].categoryName == "Open_Palm") {
            gesture = "Dung";
            console.log("Dung");
          }
        } else {
          const gesture_1 = gestures[0][0].categoryName;
          //const handednesses_1 = handednesses[0][0].categoryName;
          const gesture_2 = gestures[1][0].categoryName;
          //const handednesses_2 = handednesses[0][0].categoryName;
          console.log("2 tay ne`");
          console.log(gesture_1, gesture_2)
          
          if (gesture_1 == "Pointing_Up" && gesture_2 == "Pointing_Up"){
            gesture = "Tien";
            console.log("Tien");
          }
          if (gesture_1 == "Thumb_Right" && gesture_2 == "Thumb_Right"){
            gesture = "Phai";
            console.log("Phai");
          }
          if (gesture_1 == "Thumb_Left" && gesture_2 == "Thumb_Left"){
            gesture = "Trai";
            console.log("Trai");
          }
          if (gesture_1 == "Closed_Fist" && gesture_2 == "Closed_Fist"){
            gesture = "Lui";
            console.log("Lui");
          }
          if (gesture_1 == "Open_Palm" && gesture_2 == "Open_Palm"){
            gesture = "Dung";
            console.log("Dung");
          }
          //TienPhai
          if ((gesture_1 == "Pointing_Up" && gesture_2 == "Thump_Right") || (gesture_2 == "Pointing_Up" && gesture_1 == "Thump_Right")){
            gesture = "TienPhai";
            console.log("TienPhai");
          }
          //TienTrai
          if ((gesture_1 == "Pointing_Up" && gesture_2 == "Thump_Left") || (gesture_2 == "Pointing_Up" && gesture_1 == "Thump_Left")){
            gesture = "TienTrai";
            console.log("TienTrai");
          }
          //LuiPhai
          if ((gesture_1 == "Closed_Fist" && gesture_2 == "Thump_Right") || (gesture_2 == "Closed_Fist" && gesture_1 == "Thump_Right")){
            gesture = "LuiPhai";
            console.log("LuiPhai");
          }
          //LuiTrai
          if ((gesture_1 == "Closed_Fist" && gesture_2 == "Thump_Left") || (gesture_2 == "Closed_Fist" && gesture_1 == "Thump_Left")){
            gesture = "LuiTrai";
            console.log("LuiTrai");
          }
          //XoayPhai
          if ((gesture_1 == "Open_Palm" && gesture_2 == "Thump_Right") || (gesture_2 == "Open_Palm" && gesture_1 == "Thump_Right")){
            gesture = "XoayPhai";
            console.log("XoayPhai");
          }
          //XoayTrai
          if ((gesture_1 == "Open_Palm" && gesture_2 == "Thump_Left") || (gesture_2 == "Open_Palm" && gesture_1 == "Thump_Left")){
            gesture = "XoayTrai";
            console.log("XoayTrai");
          }
          console.log("---------------------------")
        }
        // if (Object.keys(controlCommandMap).includes(gesture)) {
        //   direction = controlCommandMap[gesture];
        //   }
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
              displayMessage(`Send '${direction}' command`);
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
