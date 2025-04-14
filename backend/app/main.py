import os
import io
import base64
import json
import uuid
from fastapi import FastAPI, UploadFile, File, HTTPException, Form, WebSocket, WebSocketDisconnect
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse
from PIL import Image
import torch
from diffusers import StableDiffusionImg2ImgPipeline
from dotenv import load_dotenv
import numpy as np
import logging
import asyncio
from typing import Dict, List

# Configure logging
logging.basicConfig(level=logging.INFO)
logger = logging.getLogger(__name__)

# Load environment variables
load_dotenv()

app = FastAPI(title="Ghibli Image Converter API")

# Configure CORS
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],  # In production, replace with specific domains
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# Store active WebSocket connections
active_connections: Dict[str, WebSocket] = {}

# Initialize the Stable Diffusion pipeline (this will download the model on first run)
@app.on_event("startup")
async def startup_event():
    global pipe
    try:
        # Use the nitrosocke/Ghibli-Diffusion model from Hugging Face
        model_id = "nitrosocke/Ghibli-Diffusion"
        
        # Check if CUDA is available and use it, otherwise use CPU
        device = "cuda" if torch.cuda.is_available() else "cpu"
        logger.info(f"Using device: {device}")
        
        # Load the pipeline
        pipe = StableDiffusionImg2ImgPipeline.from_pretrained(
            model_id,
            torch_dtype=torch.float16 if device == "cuda" else torch.float32,
        )
        pipe = pipe.to(device)
        logger.info(f"Model loaded successfully: {model_id}")
    except Exception as e:
        logger.error(f"Error loading model: {str(e)}")
        raise

@app.get("/")
def read_root():
    return {"message": "Welcome to the Ghibli Image Converter API"}

# WebSocket endpoint for image conversion
@app.websocket("/ws/convert-to-ghibli/{client_id}")
async def websocket_convert(websocket: WebSocket, client_id: str):
    await websocket.accept()
    active_connections[client_id] = websocket
    
    logger.info(f"WebSocket connection established for client: {client_id}")
    
    try:
        # Wait for the image data
        data = await websocket.receive_json()
        
        # Send acknowledgment
        await websocket.send_json({"status": "processing", "message": "Image received. Starting conversion..."})
        
        # Process in a non-blocking way
        asyncio.create_task(process_image(data["image"], client_id))
        
        # Keep connection open until explicitly closed
        while True:
            await asyncio.sleep(1)
            
    except WebSocketDisconnect:
        logger.info(f"WebSocket disconnected for client: {client_id}")
        if client_id in active_connections:
            del active_connections[client_id]
    except Exception as e:
        logger.error(f"WebSocket error: {str(e)}")
        await websocket.send_json({"status": "error", "message": str(e)})
        if client_id in active_connections:
            del active_connections[client_id]

async def process_image(base64_image: str, client_id: str):
    """Process the image in a background task and send updates via WebSocket"""
    websocket = active_connections.get(client_id)
    if not websocket:
        logger.error(f"No active connection for client: {client_id}")
        return
    
    try:
        # Extract the base64 data part (remove data:image/xxx;base64, prefix)
        if "," in base64_image:
            base64_data = base64_image.split(",", 1)[1]
        else:
            base64_data = base64_image
        
        # Decode base64 to image
        image_bytes = base64.b64decode(base64_data)
        init_image = Image.open(io.BytesIO(image_bytes)).convert("RGB")
        
        # Update client
        await websocket.send_json({"status": "processing", "message": "Image decoded. Preparing for conversion...", "progress": 10})
        
        # Log image info
        logger.info(f"Processing image via WebSocket: size={init_image.size}, mode={init_image.mode}")
        
        # Resize image if needed
        width, height = init_image.size
        
        # Set max dimensions for memory efficiency
        MAX_DIMENSION = 1024
        
        # Calculate aspect ratio
        aspect_ratio = width / height
        
        # Scale down if image is too large
        if width > MAX_DIMENSION or height > MAX_DIMENSION:
            logger.info(f"Image too large, scaling down from {width}x{height}")
            if width > height:
                # Landscape orientation
                width = MAX_DIMENSION
                height = int(width / aspect_ratio)
            else:
                # Portrait orientation
                height = MAX_DIMENSION
                width = int(height * aspect_ratio)
        
        # Ensure dimensions are multiples of 8 (requirement for Stable Diffusion)
        width = (width // 8) * 8
        height = (height // 8) * 8
        
        # Only resize if dimensions have changed
        if init_image.size != (width, height):
            logger.info(f"Resizing image to: {width}x{height}")
            init_image = init_image.resize((width, height), Image.LANCZOS)
            
        # Update client
        await websocket.send_json({"status": "processing", "message": "Image prepared. Starting Ghibli conversion...", "progress": 20})
        
        # Generate the Ghibli-style image
        prompt = "ghibli style, studio ghibli, hayao miyazaki, anime, detailed, vibrant colors"
        negative_prompt = "dark, blurry, distorted, low quality, low resolution"
        
        logger.info("Starting image generation with prompt: " + prompt)
        
        # Define a callback function that doesn't use modulo
        async def progress_callback(step, timestep, latents):
            try:
                # Only update every few steps to avoid overwhelming the websocket
                if step % 4 == 0:
                    progress = 20 + int(70 * (step / 40))
                    await websocket.send_json({
                        "status": "processing", 
                        "message": f"Converting image... Step {step}/40",
                        "progress": min(progress, 90)
                    })
            except Exception as e:
                logger.error(f"Error in progress callback: {str(e)}")
        
        # Setup callback_steps for more reliable progress reporting
        callback_steps = 4
        total_steps = 40
        
        # Run the pipeline with improved parameters
        result = pipe(
            prompt=prompt,
            negative_prompt=negative_prompt,
            image=init_image,
            strength=0.65,  # Reduced strength to preserve more of the original
            guidance_scale=8.5,
            num_inference_steps=total_steps,
            callback_steps=callback_steps,
            callback=lambda step, timestep, latents: asyncio.create_task(progress_callback(step, timestep, latents))
        ).images[0]
        
        # Update client
        await websocket.send_json({"status": "processing", "message": "Conversion complete. Preparing result...", "progress": 90})
        
        # Save the result image to a buffer
        buffered = io.BytesIO()
        # Save as JPEG for smaller size
        result.save(buffered, format="JPEG", quality=95)
        buffered.seek(0)
        
        # Convert to base64
        img_bytes = buffered.getvalue()
        img_str = base64.b64encode(img_bytes).decode("utf-8")
        
        logger.info(f"Image generation successful. Base64 length: {len(img_str)}")
        
        # Send the final result
        await websocket.send_json({
            "status": "complete", 
            "result_image": f"data:image/jpeg;base64,{img_str}",
            "progress": 100
        })
        
    except Exception as e:
        logger.error(f"Error processing image via WebSocket: {str(e)}")
        import traceback
        logger.error(traceback.format_exc())
        await websocket.send_json({"status": "error", "message": f"Error processing image: {str(e)}"})
    finally:
        # Clean up connection
        if client_id in active_connections:
            del active_connections[client_id]

# Keep the REST endpoint for backward compatibility
@app.post("/convert-to-ghibli")
async def convert_to_ghibli(file: UploadFile = File(...)):
    """
    Convert an uploaded image to Ghibli style using local Diffusion model
    """
    # Validate file
    if not file.content_type.startswith("image/"):
        raise HTTPException(status_code=400, detail="File must be an image")
    
    try:
        # Read image content
        image_content = await file.read()
        init_image = Image.open(io.BytesIO(image_content)).convert("RGB")
        
        # Log image info for debugging
        logger.info(f"Received image: format={init_image.format}, size={init_image.size}, mode={init_image.mode}")
        
        # Resize image if needed
        width, height = init_image.size
        
        # Set max dimensions for memory efficiency
        MAX_DIMENSION = 1024
        
        # Calculate aspect ratio
        aspect_ratio = width / height
        
        # Scale down if image is too large
        if width > MAX_DIMENSION or height > MAX_DIMENSION:
            logger.info(f"Image too large, scaling down from {width}x{height}")
            if width > height:
                # Landscape orientation
                width = MAX_DIMENSION
                height = int(width / aspect_ratio)
            else:
                # Portrait orientation
                height = MAX_DIMENSION
                width = int(height * aspect_ratio)
        
        # Ensure dimensions are multiples of 8 (requirement for Stable Diffusion)
        width = (width // 8) * 8
        height = (height // 8) * 8
        
        # Only resize if dimensions have changed
        if init_image.size != (width, height):
            logger.info(f"Resizing image to: {width}x{height}")
            init_image = init_image.resize((width, height), Image.LANCZOS)
        
        # Generate the Ghibli-style image
        prompt = "ghibli style, studio ghibli, hayao miyazaki, anime, detailed, vibrant colors"
        negative_prompt = "dark, blurry, distorted, low quality, low resolution"
        
        logger.info("Starting image generation with prompt: " + prompt)
        
        # Run the pipeline with improved parameters
        result = pipe(
            prompt=prompt,
            negative_prompt=negative_prompt,
            image=init_image,
            strength=0.65,  # Reduced strength to preserve more of the original
            guidance_scale=8.5,
            num_inference_steps=40
        ).images[0]
        
        # Save the result image to a buffer
        buffered = io.BytesIO()
        # Save as JPEG for smaller size
        result.save(buffered, format="JPEG", quality=95)
        buffered.seek(0)
        
        # Convert to base64
        img_bytes = buffered.getvalue()
        img_str = base64.b64encode(img_bytes).decode("utf-8")
        
        logger.info(f"Image generation successful. Base64 length: {len(img_str)}")
        
        # Return the base64 encoded image with correct MIME type
        return JSONResponse(content={"result_image": f"data:image/jpeg;base64,{img_str}"})
    
    except Exception as e:
        logger.error(f"Error processing image: {str(e)}")
        import traceback
        logger.error(traceback.format_exc())
        raise HTTPException(status_code=500, detail=f"Error processing image: {str(e)}")

if __name__ == "__main__":
    import uvicorn
    uvicorn.run("main:app", host="0.0.0.0", port=8000, reload=True) 