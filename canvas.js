export class CanvasManager {
  constructor(canvasElement) {
    this.canvas = canvasElement;
    this.ctx = this.canvas.getContext('2d', { alpha: true });
    
    // Separate canvas for user's own drawings (for undo/redo)
    this.userCanvas = document.createElement('canvas');
    this.userCtx = this.userCanvas.getContext('2d', { alpha: true });
    
    // Map of remote user canvases - each user gets their own canvas layer
    this.remoteCanvases = new Map();
    
    this.drawing = false;
    this.lastPos = { x: 0, y: 0 };
    this.mode = 'brush';
    this.strokeColor = '#000000';
    this.lineWidth = 5;
    
    this.undoStack = [];
    this.redoStack = [];
    this.MAX_STACK = 50;
    
    this.onStateChange = null;
    
    this.initCanvas();
    this.setupEventListeners();
  }
  
  initCanvas() {
    this.setCanvasSize();
    window.addEventListener('resize', () => this.setCanvasSize());
  }
  
  // Resize canvas while preserving content and handling high-DPI displays
  setCanvasSize() {
    const rect = this.canvas.getBoundingClientRect();
    const userData = this.userCanvas.toDataURL();
    
    // Save all remote canvas data
    const remoteDataMap = new Map();
    for (const [userId, remoteCanvas] of this.remoteCanvases) {
      remoteDataMap.set(userId, remoteCanvas.canvas.toDataURL());
    }
    
    const dpr = window.devicePixelRatio || 1;
    
    this.canvas.width = Math.floor(rect.width * dpr);
    this.canvas.height = Math.floor(rect.height * dpr);
    this.userCanvas.width = this.canvas.width;
    this.userCanvas.height = this.canvas.height;
    
    this.ctx.scale(dpr, dpr);
    this.userCtx.scale(dpr, dpr);
    
    this.ctx.imageSmoothingEnabled = true;
    this.ctx.imageSmoothingQuality = 'high';
    this.userCtx.imageSmoothingEnabled = true;
    this.userCtx.imageSmoothingQuality = 'high';
    
    const userImg = new Image();
    userImg.onload = () => {
      this.userCtx.clearRect(0, 0, this.userCanvas.width, this.userCanvas.height);
      this.userCtx.drawImage(userImg, 0, 0, rect.width, rect.height);
      this.composeLayers();
    };
    userImg.src = userData;
    
    // Restore remote canvases
    for (const [userId, dataUrl] of remoteDataMap) {
      const remoteCanvas = this.getOrCreateRemoteCanvas(userId);
      const img = new Image();
      img.onload = () => {
        remoteCanvas.ctx.clearRect(0, 0, remoteCanvas.canvas.width, remoteCanvas.canvas.height);
        remoteCanvas.ctx.drawImage(img, 0, 0, rect.width, rect.height);
      };
      img.src = dataUrl;
    }
  }
  
  // Get or create a canvas for a remote user
  getOrCreateRemoteCanvas(userId) {
    if (!this.remoteCanvases.has(userId)) {
      const canvas = document.createElement('canvas');
      const ctx = canvas.getContext('2d', { alpha: true });
      
      const dpr = window.devicePixelRatio || 1;
      canvas.width = this.canvas.width;
      canvas.height = this.canvas.height;
      
      ctx.scale(dpr, dpr);
      ctx.imageSmoothingEnabled = true;
      ctx.imageSmoothingQuality = 'high';
      
      this.remoteCanvases.set(userId, { canvas, ctx });
    }
    return this.remoteCanvases.get(userId);
  }
  
  // Merge user's own drawings and remote users' drawings onto the display canvas
  composeLayers() {
    const rect = this.canvas.getBoundingClientRect();
    
    this.ctx.save();
    this.ctx.setTransform(1, 0, 0, 1, 0, 0);
    this.ctx.clearRect(0, 0, this.canvas.width, this.canvas.height);
    this.ctx.restore();
    
    // Draw user's canvas first
    this.ctx.globalCompositeOperation = 'source-over';
    this.ctx.drawImage(this.userCanvas, 0, 0, rect.width, rect.height);
    
    // Draw each remote user's canvas on top
    for (const [userId, remoteCanvas] of this.remoteCanvases) {
      this.ctx.drawImage(remoteCanvas.canvas, 0, 0, rect.width, rect.height);
    }
  }
  
  setupEventListeners() {
    this.canvas.addEventListener('pointerdown', (e) => this.handlePointerDown(e));
    this.canvas.addEventListener('pointermove', (e) => this.handlePointerMove(e));
    this.canvas.addEventListener('pointerup', (e) => this.handlePointerUp(e));
    this.canvas.addEventListener('pointercancel', (e) => this.handlePointerUp(e));
    this.canvas.addEventListener('touchstart', (e) => e.preventDefault(), { passive: false });
  }
  
  getPointerPos(e) {
    const rect = this.canvas.getBoundingClientRect();
    return {
      x: (e.clientX - rect.left),
      y: (e.clientY - rect.top)
    };
  }
  
  // Capture pointer to prevent losing events if cursor leaves canvas during drawing
  handlePointerDown(e) {
    if (e.button !== undefined && e.button !== 0) return;
    
    this.canvas.setPointerCapture(e.pointerId);
    this.pushUndo();
    
    this.drawing = true;
    this.lastPos = this.getPointerPos(e);
    
    this.userCtx.lineCap = 'round';
    this.userCtx.lineJoin = 'round';
    this.userCtx.lineWidth = this.lineWidth;
    
    if (this.mode === 'eraser') {
      this.userCtx.globalCompositeOperation = 'destination-out';
      this.userCtx.strokeStyle = 'rgba(0,0,0,1)';
    } else {
      this.userCtx.globalCompositeOperation = 'source-over';
      this.userCtx.strokeStyle = this.strokeColor;
    }
    
    this.userCtx.beginPath();
    this.userCtx.moveTo(this.lastPos.x, this.lastPos.y);
    
    // Send drawing events for both brush and eraser
    this.emitDrawEvent('start', this.lastPos);
  }
  
  handlePointerMove(e) {
    if (!this.drawing) return;
    
    const pos = this.getPointerPos(e);
    this.userCtx.lineTo(pos.x, pos.y);
    this.userCtx.stroke();
    this.lastPos = pos;
    
    // Update display canvas in real-time
    this.composeLayers();
    
    // Send drawing events for both brush and eraser
    this.emitDrawEvent('move', pos);
  }
  
  handlePointerUp(e) {
    if (!this.drawing) return;
    
    this.drawing = false;
    this.userCtx.closePath();
    this.redoStack.length = 0;
    
    try {
      this.canvas.releasePointerCapture(e.pointerId);
    } catch (err) {}
    
    // Send drawing events for both brush and eraser
    this.emitDrawEvent('end', this.lastPos);
    
    this.composeLayers();
  }
  
  setMode(mode) {
    this.mode = mode;
    if (this.onStateChange) this.onStateChange('mode', mode);
  }
  
  setColor(color) {
    this.strokeColor = color;
    if (this.onStateChange) this.onStateChange('color', color);
  }
  
  setLineWidth(width) {
    this.lineWidth = width;
    if (this.onStateChange) this.onStateChange('width', width);
  }
  
  pushUndo() {
    if (this.undoStack.length >= this.MAX_STACK) this.undoStack.shift();
    this.undoStack.push(this.userCanvas.toDataURL());
  }
  
  undo() {
    if (this.undoStack.length === 0) return Promise.resolve(false);
    
    this.redoStack.push(this.userCanvas.toDataURL());
    const dataUrl = this.undoStack.pop();
    return this.applyDataUrl(dataUrl).then(() => true);
  }
  
  redo() {
    if (this.redoStack.length === 0) return Promise.resolve(false);
    
    this.undoStack.push(this.userCanvas.toDataURL());
    const dataUrl = this.redoStack.pop();
    return this.applyDataUrl(dataUrl).then(() => true);
  }
  
  applyDataUrl(dataUrl) {
    return new Promise((resolve, reject) => {
      const img = new Image();
      img.onload = () => {
        const rect = this.canvas.getBoundingClientRect();
        this.userCtx.save();
        this.userCtx.setTransform(1, 0, 0, 1, 0, 0);
        this.userCtx.clearRect(0, 0, this.userCanvas.width, this.userCanvas.height);
        this.userCtx.restore();
        this.userCtx.globalCompositeOperation = 'source-over';
        this.userCtx.drawImage(img, 0, 0, rect.width, rect.height);
        this.composeLayers();
        resolve();
      };
      img.onerror = () => {
        console.error('Failed to apply canvas data');
        reject(new Error('Failed to load image'));
      };
      img.src = dataUrl;
    });
  }
  
  clear() {
    this.pushUndo();
    this.userCtx.save();
    this.userCtx.setTransform(1, 0, 0, 1, 0, 0);
    this.userCtx.clearRect(0, 0, this.userCanvas.width, this.userCanvas.height);
    this.userCtx.restore();
    this.redoStack.length = 0;
    this.composeLayers();
  }
  
  clearRemoteCanvas(userId) {
    // Clear only a specific user's remote canvas (when they clear their drawings)
    if (!userId) {
      console.warn('clearRemoteCanvas called without userId');
      return;
    }
    
    const remoteCanvas = this.remoteCanvases.get(userId);
    if (remoteCanvas) {
      remoteCanvas.ctx.save();
      remoteCanvas.ctx.setTransform(1, 0, 0, 1, 0, 0);
      remoteCanvas.ctx.clearRect(0, 0, remoteCanvas.canvas.width, remoteCanvas.canvas.height);
      remoteCanvas.ctx.restore();
      this.composeLayers();
    }
  }
  
  removeRemoteUser(userId) {
    // Remove a user's canvas when they leave
    if (this.remoteCanvases.has(userId)) {
      this.remoteCanvases.delete(userId);
      this.composeLayers();
    }
  }
  
  updateRemoteCanvas(userId, dataUrl) {
    // Update a specific user's canvas with new data (for undo/redo sync)
    if (!userId || !dataUrl) {
      console.warn('updateRemoteCanvas called with invalid parameters', { userId, hasDataUrl: !!dataUrl });
      return;
    }
    
    console.log('Updating remote canvas for user:', userId);
    const remoteCanvas = this.getOrCreateRemoteCanvas(userId);
    const img = new Image();
    img.onload = () => {
      const rect = this.canvas.getBoundingClientRect();
      remoteCanvas.ctx.save();
      remoteCanvas.ctx.setTransform(1, 0, 0, 1, 0, 0);
      remoteCanvas.ctx.clearRect(0, 0, remoteCanvas.canvas.width, remoteCanvas.canvas.height);
      remoteCanvas.ctx.restore();
      remoteCanvas.ctx.globalCompositeOperation = 'source-over';
      remoteCanvas.ctx.drawImage(img, 0, 0, rect.width, rect.height);
      console.log('Remote canvas updated and composing layers');
      this.composeLayers();
    };
    img.onerror = () => {
      console.error('Failed to load image for remote canvas update');
    };
    img.src = dataUrl;
  }
  
  download(filename = 'canvas.png') {
    const a = document.createElement('a');
    a.href = this.canvas.toDataURL('image/png');
    a.download = filename;
    a.click();
  }
  
  emitDrawEvent(type, pos) {
    if (this.onStateChange) {
      this.onStateChange('draw', {
        type,
        pos,
        mode: this.mode,
        color: this.strokeColor,
        width: this.lineWidth
      });
    }
  }
  
  // Draw remote user strokes on their separate canvas layer (including eraser strokes)
  applyRemoteDrawing(drawData) {
    const { type, pos, mode, color, width, userId } = drawData;
    
    if (!userId) {
      console.warn('Drawing data missing userId:', drawData);
      return;
    }
    
    const remoteCanvas = this.getOrCreateRemoteCanvas(userId);
    const ctx = remoteCanvas.ctx;
    
    ctx.lineCap = 'round';
    ctx.lineJoin = 'round';
    ctx.lineWidth = width;
    
    if (mode === 'eraser') {
      // Apply eraser effect to this user's layer only
      ctx.globalCompositeOperation = 'destination-out';
      ctx.strokeStyle = 'rgba(0,0,0,1)';
    } else {
      // Normal brush drawing
      ctx.globalCompositeOperation = 'source-over';
      ctx.strokeStyle = color;
    }
    
    if (type === 'start') {
      ctx.beginPath();
      ctx.moveTo(pos.x, pos.y);
    } else if (type === 'move') {
      ctx.lineTo(pos.x, pos.y);
      ctx.stroke();
      this.composeLayers();
    } else if (type === 'end') {
      ctx.closePath();
      this.composeLayers();
    }
  }
  
  getCanvasData() {
    return this.userCanvas.toDataURL();
  }
  
  loadCanvasData(dataUrl) {
    this.applyDataUrl(dataUrl);
  }
}
