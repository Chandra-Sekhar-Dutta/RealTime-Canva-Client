export class WebSocketClient {
  constructor(serverUrl = 'http://localhost:3000') {
    this.serverUrl = serverUrl;
    this.socket = null;
    this.connected = false;
    this.roomId = null;
    this.userId = null;
    this.username = null;
    this.userColor = null;
    
    this.onConnect = null;
    this.onDisconnect = null;
    this.onDrawing = null;
    this.onCanvasState = null;
    this.onError = null;
    this.onUserJoin = null;
    this.onUserLeave = null;
    this.onCursorMove = null;
    this.onUsersUpdate = null;
    this.onUsernameAssigned = null;
    this.onClearCanvas = null;
    this.onUndo = null;
    this.onRedo = null;
  }
  
  // Establish connection with fallback to polling if WebSocket fails
  connect(roomId = 'default', userInfo = {}) {
    this.roomId = roomId;
    this.userId = userInfo.userId || Math.random().toString(36).substring(7);
    this.username = userInfo.username || 'Anonymous';
    this.userColor = userInfo.color || '#6366f1';
    
    try {
      if (typeof io !== 'undefined') {
        this.socket = io(this.serverUrl, {
          transports: ['websocket', 'polling'],
          reconnection: true,
          reconnectionAttempts: 5,
          reconnectionDelay: 1000
        });
        
        this.setupSocketListeners();
      } else {
        console.warn('Socket.io client not loaded. Running in offline mode.');
        if (this.onError) this.onError('Socket.io client not available');
      }
    } catch (error) {
      console.error('WebSocket connection error:', error);
      if (this.onError) this.onError(error);
    }
  }
  
  setupSocketListeners() {
    this.socket.on('connect', () => {
      console.log('Connected to server');
      this.connected = true;
      
      this.socket.emit('join-room', { 
        roomId: this.roomId, 
        userId: this.userId,
        username: this.username,
        color: this.userColor
      });
      
      if (this.onConnect) this.onConnect();
    });
    
    this.socket.on('disconnect', () => {
      console.log('Disconnected from server');
      this.connected = false;
      
      if (this.onDisconnect) this.onDisconnect();
    });
    
    // Ignore drawing events from self to prevent double-drawing
    this.socket.on('drawing', (data) => {
      console.log('Received drawing event from server:', {
        type: data.type,
        userId: data.userId,
        myUserId: this.userId,
        strokeId: data.strokeId,
        shouldProcess: data.userId !== this.userId
      });
      
      if (data.userId !== this.userId && this.onDrawing) {
        this.onDrawing(data);
      } else if (data.userId === this.userId) {
        console.log('Skipping own drawing event');
      }
    });
    
    this.socket.on('canvas-state', (data) => {
      console.log('Received canvas state');
      if (this.onCanvasState) this.onCanvasState(data);
    });
    
    this.socket.on('user-joined', (data) => {
      console.log('User joined:', data.username);
      if (this.onUserJoin) this.onUserJoin(data);
    });
    
    this.socket.on('user-left', (data) => {
      console.log('User left:', data.username);
      if (this.onUserLeave) this.onUserLeave(data);
    });
    
    this.socket.on('cursor-move', (data) => {
      if (data.userId !== this.userId && this.onCursorMove) {
        this.onCursorMove(data);
      }
    });
    
    this.socket.on('users-update', (data) => {
      if (this.onUsersUpdate) this.onUsersUpdate(data.users);
    });
    
    this.socket.on('username-assigned', (data) => {
      console.log('Username assigned:', data.username);
      this.username = data.username;
      if (this.onUsernameAssigned) this.onUsernameAssigned(data.username);
    });
    
    this.socket.on('clear-canvas', (data) => {
      console.log('Canvas cleared by:', data.userId);
      if (this.onClearCanvas) this.onClearCanvas(data);
    });
    
    this.socket.on('undo', (data) => {
      console.log('Undo event from:', data.userId);
      if (data.userId !== this.userId && this.onUndo) {
        this.onUndo(data);
      }
    });
    
    this.socket.on('redo', (data) => {
      console.log('Redo event from:', data.userId);
      if (data.userId !== this.userId && this.onRedo) {
        this.onRedo(data);
      }
    });
    
    this.socket.on('error', (error) => {
      console.error('Socket error:', error);
      if (this.onError) this.onError(error);
    });
  }
  
  sendDrawing(drawData) {
    if (!this.connected || !this.socket) return;
    
    this.socket.emit('drawing', {
      roomId: this.roomId,
      userId: this.userId,
      ...drawData
    });
  }
  
  sendCursorPosition(pos) {
    if (!this.connected || !this.socket) return;
    
    this.socket.emit('cursor-move', {
      roomId: this.roomId,
      userId: this.userId,
      pos
    });
  }
  
  requestCanvasState() {
    if (!this.connected || !this.socket) return;
    
    this.socket.emit('request-canvas-state', {
      roomId: this.roomId,
      userId: this.userId
    });
  }
  
  sendCanvasState(canvasData) {
    if (!this.connected || !this.socket) return;
    
    this.socket.emit('canvas-state', {
      roomId: this.roomId,
      userId: this.userId,
      canvasData
    });
  }
  
  clearCanvas() {
    if (!this.connected || !this.socket) return;
    
    this.socket.emit('clear-canvas', {
      roomId: this.roomId,
      userId: this.userId
    });
  }
  
  sendUndo(canvasData) {
    if (!this.connected || !this.socket) return;
    
    this.socket.emit('undo', {
      roomId: this.roomId,
      userId: this.userId,
      canvasData
    });
  }
  
  sendRedo(canvasData) {
    if (!this.connected || !this.socket) return;
    
    this.socket.emit('redo', {
      roomId: this.roomId,
      userId: this.userId,
      canvasData
    });
  }
  
  disconnect() {
    if (this.socket) {
      this.socket.disconnect();
      this.connected = false;
    }
  }
  
  isConnected() {
    return this.connected;
  }
}
