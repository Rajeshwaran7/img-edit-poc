# Ghibli Image Converter - Backend

A FastAPI-based backend that converts uploaded images to Studio Ghibli style using the Hugging Face Ghibli Diffusion model.

## Setup

1. Create a virtual environment:
   ```
   python -m venv venv
   ```

2. Activate the virtual environment:
   - Windows: `venv\Scripts\activate`
   - Mac/Linux: `source venv/bin/activate`

3. Install dependencies:
   ```
   pip install -r requirements.txt
   ```

   Note: Installing the dependencies may take some time as it downloads the Ghibli diffusion model.

4. No API keys are required as the backend uses a local model.

## Running the API

Start the FastAPI server:

```
cd app
uvicorn main:app --reload
```

The API will be available at: http://localhost:8000

## API Endpoints

- `GET /` - Health check
- `POST /convert-to-ghibli` - Upload and convert an image to Ghibli style

## Model Information

This backend uses the "nitrosocke/Ghibli-Diffusion" model from Hugging Face, which is specifically fine-tuned to produce Studio Ghibli style images.

## Hardware Requirements

- For optimal performance, a CUDA-capable GPU is recommended
- If running on CPU only, the conversion process will be significantly slower
- At least 8GB of RAM is recommended (16GB+ preferred)

## Documentation

When the server is running, you can access the auto-generated API documentation at:
- http://localhost:8000/docs
- http://localhost:8000/redoc 