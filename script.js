const form = document.querySelector("#upload-form");
const input = document.querySelector("#media-input");
const dropZone = document.querySelector("#drop-zone");
const chooseButton = document.querySelector("#choose-button");
const analyzeButton = document.querySelector("#analyze-button");
const dropContent = document.querySelector("#drop-content");
const preview = document.querySelector("#preview");
const imagePreview = document.querySelector("#image-preview");
const videoPreview = document.querySelector("#video-preview");
const fileName = document.querySelector("#file-name");
const errorMessage = document.querySelector("#error-message");
const resultEmpty = document.querySelector("#result-empty");
const resultContent = document.querySelector("#result-content");
const resultLabel = document.querySelector("#result-label");
const confidenceValue = document.querySelector("#confidence-value");
const confidenceBar = document.querySelector("#confidence-bar");
const resultNote = document.querySelector("#result-note");

let selectedFile = null;
let previewUrl = null;
let model = null;
let modelReady = false;
const MODEL_SIZE = 299;

function updateAnalyzeButton() {
  analyzeButton.disabled = !selectedFile;
}

function showError(message) {
  errorMessage.textContent = message;
}

function setFile(file) {
  if (!file) return;
  if (!file.type.startsWith("image/") && !file.type.startsWith("video/")) {
    showError("Please choose an image or video file.");
    return;
  }

  if (previewUrl) URL.revokeObjectURL(previewUrl);
  selectedFile = file;
  previewUrl = URL.createObjectURL(file);
  const isVideo = file.type.startsWith("video/");
  imagePreview.hidden = isVideo;
  videoPreview.hidden = !isVideo;
  (isVideo ? videoPreview : imagePreview).src = previewUrl;
  fileName.textContent = file.name;
  dropContent.hidden = true;
  preview.hidden = false;
  updateAnalyzeButton();
  showError("");
}

async function loadModel() {
  document.querySelector(".model-status").innerHTML = '<span class="status-dot"></span> Loading model';
  try {
    const modelPaths = ["tfjs_model/model.json", "model.json"];
    let lastError;
    for (const modelPath of modelPaths) {
      try {
        const modelUrl = new URL(modelPath, document.baseURI).href;
        model = await tf.loadGraphModel(modelUrl);
        break;
      } catch (error) {
        lastError = error;
      }
    }
    if (!model) throw lastError || new Error("No browser model was found.");
    modelReady = true;
    updateAnalyzeButton();
    document.querySelector(".model-status").innerHTML = '<span class="status-dot"></span> Model loaded';
  } catch (error) {
    modelReady = false;
    updateAnalyzeButton();
    document.querySelector(".model-status").innerHTML = '<span class="status-dot" style="background:#c85d35"></span> Model unavailable';
    console.error("Failed to load browser model:", error);
  }
}

function imageTensor(source) {
  return tf.tidy(() => tf.browser.fromPixels(source)
    .resizeBilinear([MODEL_SIZE, MODEL_SIZE])
    .toFloat()
    .div(127.5)
    .sub(1)
    .expandDims(0));
}

async function predictImage(image) {
  const prediction = model.predict(imageTensor(image));
  const value = (await prediction.data())[0];
  prediction.dispose();
  return value;
}

async function predictVideo(video) {
  const canvas = document.createElement("canvas");
  canvas.width = MODEL_SIZE;
  canvas.height = MODEL_SIZE;
  const context = canvas.getContext("2d", { willReadFrequently: true });
  const frameCount = Math.min(12, Math.max(1, Math.floor(video.duration * 2)));
  const values = [];
  for (let index = 0; index < frameCount; index += 1) {
    video.currentTime = (video.duration * index) / frameCount;
    await new Promise((resolve) => video.addEventListener("seeked", resolve, { once: true }));
    context.drawImage(video, 0, 0, MODEL_SIZE, MODEL_SIZE);
    values.push(await predictImage(canvas));
  }
  return values.reduce((sum, value) => sum + value, 0) / values.length;
}

chooseButton.addEventListener("click", () => input.click());
dropZone.addEventListener("click", () => input.click());
dropZone.addEventListener("keydown", (event) => {
  if (event.key === "Enter" || event.key === " ") input.click();
});
input.addEventListener("change", () => setFile(input.files[0]));

["dragenter", "dragover"].forEach((eventName) => {
  dropZone.addEventListener(eventName, (event) => {
    event.preventDefault();
    dropZone.classList.add("is-dragging");
  });
});
["dragleave", "drop"].forEach((eventName) => {
  dropZone.addEventListener(eventName, (event) => {
    event.preventDefault();
    dropZone.classList.remove("is-dragging");
  });
});
dropZone.addEventListener("drop", (event) => setFile(event.dataTransfer.files[0]));

form.addEventListener("submit", async (event) => {
  event.preventDefault();
  if (!selectedFile) return;

  analyzeButton.disabled = true;
  analyzeButton.textContent = "Analyzing...";
  showError("");

  try {
    if (!modelReady) {
      analyzeButton.textContent = "Loading model...";
      await modelPromise;
    }
    if (!model) throw new Error("The model could not be loaded.");
    const isVideo = selectedFile.type.startsWith("video/");
    const value = isVideo
      ? await predictVideo(videoPreview)
      : await new Promise((resolve, reject) => {
        const image = new Image();
        image.onload = async () => resolve(await predictImage(image));
        image.onerror = () => reject(new Error("The selected image could not be read."));
        image.src = previewUrl;
      });
    const label = value >= 0.5 ? "fake" : "real";
    const confidence = Math.round((label === "fake" ? value : 1 - value) * 100);
    resultEmpty.hidden = true;
    resultContent.hidden = false;
    resultLabel.textContent = label === "real" ? "Likely authentic" : "Likely manipulated";
    resultLabel.className = `result-label is-${label}`;
    confidenceValue.textContent = `${Math.max(0, Math.min(100, confidence))}%`;
    confidenceBar.style.width = `${Math.max(0, Math.min(100, confidence))}%`;
    resultNote.textContent = label === "real"
      ? "No strong manipulation signals were detected by the model."
      : "The model detected patterns commonly associated with synthetic or altered media.";
  } catch (error) {
    showError(error.message || "The model could not analyze this file.");
  } finally {
    analyzeButton.disabled = false;
    analyzeButton.textContent = "Run analysis";
  }
});

const modelPromise = loadModel();
