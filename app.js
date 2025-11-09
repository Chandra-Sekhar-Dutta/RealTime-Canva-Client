(function(){
  const canvas = document.getElementById('canvas');
  const ctx = canvas.getContext('2d', { alpha: true });

  const brushBtn = document.getElementById('brushBtn');
  const eraserBtn = document.getElementById('eraserBtn');
  const colorPicker = document.getElementById('colorPicker');
  const colorHex = document.getElementById('colorHex');
  const widthRange = document.getElementById('widthRange');
  const widthLabel = document.getElementById('widthLabel');
  const brushPreview = document.getElementById('brushPreview');
  const undoBtn = document.getElementById('undoBtn');
  const redoBtn = document.getElementById('redoBtn');
  const clearBtn = document.getElementById('clearBtn');
  const downloadBtn = document.getElementById('downloadBtn');
  const canvasSize = document.getElementById('canvasSize');
  const toolIndicator = document.getElementById('toolIndicator');
  const cursorPreview = document.getElementById('cursorPreview');

  let drawing = false;
  let lastPos = {x:0,y:0};
  let mode = 'brush'; // or 'eraser'
  let strokeColor = colorPicker.value;
  let lineWidth = parseInt(widthRange.value,10);

  // Undo/Redo stacks (store dataURLs)
  const undoStack = [];
  const redoStack = [];
  const MAX_STACK = 50;

  function setCanvasSize(){
    const rect = canvas.getBoundingClientRect();
    // Save current content
    const data = canvas.toDataURL();
    canvas.width = Math.floor(rect.width);
    canvas.height = Math.floor(rect.height);
    // Restore
    const img = new Image();
    img.onload = ()=>{
      ctx.clearRect(0,0,canvas.width,canvas.height);
      ctx.drawImage(img,0,0,canvas.width,canvas.height);
    };
    img.src = data;
    updateCanvasSizeDisplay();
  }

  function updateCanvasSizeDisplay(){
    if(canvasSize){
      canvasSize.querySelector('span').textContent = `${canvas.width} × ${canvas.height}`;
    }
  }

  window.addEventListener('resize', ()=>{
    setCanvasSize();
  });

  // Initialize size after DOM layout
  
  requestAnimationFrame(setCanvasSize);

  function setMode(newMode){
    mode = newMode;
    if(mode === 'eraser'){
      eraserBtn.classList.add('active');
      brushBtn.classList.remove('active');
      if(toolIndicator){
        toolIndicator.querySelector('i').className = 'fas fa-eraser';
        toolIndicator.querySelector('span').textContent = 'Eraser Mode';
      }
    } else {
      brushBtn.classList.add('active');
      eraserBtn.classList.remove('active');
      if(toolIndicator){
        toolIndicator.querySelector('i').className = 'fas fa-paintbrush';
        toolIndicator.querySelector('span').textContent = 'Brush Mode';
      }
    }
    updateBrushPreview();
  }

  function updateBrushPreview(){
    if(brushPreview){
      const size = Math.min(lineWidth, 60);
      brushPreview.style.setProperty('--preview-size', size + 'px');
      brushPreview.style.color = mode === 'eraser' ? '#94a3b8' : strokeColor;
      const preview = brushPreview.querySelector('::before') || brushPreview;
      if(preview){
        preview.style.width = size + 'px';
        preview.style.height = size + 'px';
      }
    }
  }

  function updateColorHex(){
    if(colorHex){
      colorHex.textContent = strokeColor.toUpperCase();
    }
  }

  brushBtn.addEventListener('click', ()=> setMode('brush'));
  eraserBtn.addEventListener('click', ()=> setMode('eraser'));

  colorPicker.addEventListener('input', (e)=>{
    strokeColor = e.target.value;
    updateColorHex();
    updateBrushPreview();
  });
  widthRange.addEventListener('input', (e)=>{
    lineWidth = parseInt(e.target.value,10);
    widthLabel.textContent = lineWidth + 'px';
    updateBrushPreview();
    updateCursorPreview();
  });

  function getPointerPos(e){
    const rect = canvas.getBoundingClientRect();
    return {
      x: (e.clientX - rect.left) * (canvas.width / rect.width),
      y: (e.clientY - rect.top) * (canvas.height / rect.height)
    };
  }

  function updateCursorPreview(e){
    if(!cursorPreview) return;
    if(e){
      const rect = canvas.getBoundingClientRect();
      cursorPreview.style.left = e.clientX - rect.left + 'px';
      cursorPreview.style.top = e.clientY - rect.top + 'px';
      cursorPreview.style.width = lineWidth + 'px';
      cursorPreview.style.height = lineWidth + 'px';
      cursorPreview.style.opacity = '1';
      if(mode === 'eraser'){
        cursorPreview.style.borderColor = '#94a3b8';
      } else {
        cursorPreview.style.borderColor = strokeColor;
      }
    } else {
      cursorPreview.style.opacity = '0';
    }
  }

  function beginStroke(e){
    // push snapshot for undo BEFORE modification so undo restores previous state
    pushUndo();
    drawing = true;
    lastPos = getPointerPos(e);
    ctx.lineCap = 'round';
    ctx.lineJoin = 'round';
    ctx.lineWidth = lineWidth;
    if(mode === 'eraser'){
      ctx.globalCompositeOperation = 'destination-out';
      ctx.strokeStyle = 'rgba(0,0,0,1)';
    } else {
      ctx.globalCompositeOperation = 'source-over';
      ctx.strokeStyle = strokeColor;
    }
    ctx.beginPath();
    ctx.moveTo(lastPos.x, lastPos.y);
  }

  function moveStroke(e){
    if(!drawing) return;
    const p = getPointerPos(e);
    ctx.lineTo(p.x, p.y);
    ctx.stroke();
    lastPos = p;
  }

  function endStroke(e){
    if(!drawing) return;
    drawing = false;
    ctx.closePath();
    // clear redo stack after new action
    redoStack.length = 0;
  }

  // Pointer / mouse / touch events (use pointer events for unified handling)
  canvas.addEventListener('pointerdown', (e)=>{
    // only respond to primary button
    if(e.button !== undefined && e.button !== 0) return;
    canvas.setPointerCapture(e.pointerId);
    beginStroke(e);
  });
  canvas.addEventListener('pointermove', (e)=>{
    moveStroke(e);
    updateCursorPreview(e);
  });
  canvas.addEventListener('pointerup', (e)=>{
    endStroke(e);
    try{ canvas.releasePointerCapture(e.pointerId); }catch(err){}
  });
  canvas.addEventListener('pointercancel', (e)=>{
    endStroke(e);
  });
  canvas.addEventListener('pointerleave', (e)=>{
    updateCursorPreview(null);
  });
  canvas.addEventListener('pointerenter', (e)=>{
    updateCursorPreview(e);
  });

  // Undo/Redo implementation using dataURLs
  
  function pushUndo(){
    if(undoStack.length >= MAX_STACK) undoStack.shift();
    undoStack.push(canvas.toDataURL());
    // limit redo size too
    if(redoStack.length > MAX_STACK) redoStack.shift();
    updateButtons();
  }

  function applyDataUrlToCanvas(dataUrl){
    const img = new Image();
    img.onload = ()=>{
      ctx.clearRect(0,0,canvas.width,canvas.height);
      ctx.drawImage(img,0,0,canvas.width,canvas.height);
      updateButtons();
    };
    img.src = dataUrl;
  }

  undoBtn.addEventListener('click', ()=>{
    if(undoStack.length === 0) return;
    // push current to redo
    redoStack.push(canvas.toDataURL());
    const last = undoStack.pop();
    applyDataUrlToCanvas(last);
  });

  redoBtn.addEventListener('click', ()=>{
    if(redoStack.length === 0) return;
    undoStack.push(canvas.toDataURL());
    const last = redoStack.pop();
    applyDataUrlToCanvas(last);
  });

  clearBtn.addEventListener('click', ()=>{
    pushUndo();
    ctx.clearRect(0,0,canvas.width,canvas.height);
    redoStack.length = 0;
    updateButtons();
  });

  downloadBtn.addEventListener('click', ()=>{
    const a = document.createElement('a');
    a.href = canvas.toDataURL('image/png');
    a.download = 'canvas.png';
    a.click();
  });

  function updateButtons(){
    undoBtn.disabled = undoStack.length === 0;
    redoBtn.disabled = redoStack.length === 0;
  }
  updateButtons();

  // Keyboard shortcuts: Ctrl+Z / Ctrl+Y / Ctrl+Shift+Z / B / E
  window.addEventListener('keydown', (e)=>{
    const ctrl = e.ctrlKey || e.metaKey;
    
    // Undo/Redo
    if(ctrl && e.key.toLowerCase() === 'z'){
      e.preventDefault();
      if(e.shiftKey) {
        // redo
        redoBtn.click();
      } else {
        undoBtn.click();
      }
    } else if((ctrl && e.key.toLowerCase() === 'y')){
      e.preventDefault();
      redoBtn.click();
    }
    // Tool shortcuts
    else if(e.key.toLowerCase() === 'b' && !ctrl){
      e.preventDefault();
      setMode('brush');
    } else if(e.key.toLowerCase() === 'e' && !ctrl){
      e.preventDefault();
      setMode('eraser');
    }
  });

  // Prevent gestures on mobile from interfering
  canvas.addEventListener('touchstart', (e)=> e.preventDefault(), {passive:false});

  // On load: fill with transparent background (or white if you prefer)
  
  function initCanvasEmpty(){
    // set a white background so PNGs have white background instead of transparent (optional)
    // ctx.fillStyle = '#fff'; ctx.fillRect(0,0,canvas.width,canvas.height);
    pushUndo();
    updateBrushPreview();
    updateColorHex();
    updateCanvasSizeDisplay();
  }
  // Wait for initial size to be set then init
  setTimeout(()=>{
    setCanvasSize();
    initCanvasEmpty();
  }, 50);

})();
