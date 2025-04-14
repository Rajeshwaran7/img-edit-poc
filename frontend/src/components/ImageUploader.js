import React, { useState, useCallback, useEffect, useRef } from 'react';
import { useDropzone } from 'react-dropzone';
import axios from 'axios';
import './ImageUploader.css';

const API_URL = 'http://localhost:8000';
const WS_URL = 'ws://localhost:8000';

const ImageUploader = () => {
  const [uploadedImage, setUploadedImage] = useState(null);
  const [convertedImage, setConvertedImage] = useState(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [progress, setProgress] = useState(0);
  const [showTips, setShowTips] = useState(false);
  const [statusMessage, setStatusMessage] = useState('');
  const socketRef = useRef(null);
  const clientIdRef = useRef(`client-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`);

  // Cleanup socket on unmount
  useEffect(() => {
    return () => {
      if (socketRef.current && socketRef.current.readyState === WebSocket.OPEN) {
        socketRef.current.close();
      }
    };
  }, []);

  // Progress animation during loading (only used for REST API fallback)
  useEffect(() => {
    let interval;
    if (loading && !socketRef.current) {
      // Reset progress
      setProgress(0);
      // Simulate progress (since we don't have real progress from the API)
      interval = setInterval(() => {
        setProgress(prevProgress => {
          // Slow down as we approach 90%
          const increment = (90 - prevProgress) / 20;
          const newProgress = Math.min(prevProgress + increment, 90);
          return newProgress;
        });
      }, 1000);
    } else if (progress > 0 && !socketRef.current) {
      // If loading finished and we had progress, set to 100
      setProgress(100);
      // Reset progress after animation completes
      setTimeout(() => setProgress(0), 1000);
    }

    return () => {
      if (interval) clearInterval(interval);
    };
  }, [loading, progress]);

  const onDrop = useCallback(acceptedFiles => {
    setError('');
    const file = acceptedFiles[0];
    
    if (file) {
      // Check file size (max 10MB)
      if (file.size > 10 * 1024 * 1024) {
        setError('File is too large. Maximum size is 10MB.');
        return;
      }
      
      // Preview the uploaded image
      const reader = new FileReader();
      reader.onload = () => {
        setUploadedImage(reader.result);
        setConvertedImage(null); // Clear any previous converted image
        setShowTips(true); // Show tips after successful upload
      };
      reader.onerror = () => {
        setError('Error reading file. Please try another image.');
      };
      reader.readAsDataURL(file);
    }
  }, []);

  const { getRootProps, getInputProps, isDragActive } = useDropzone({
    onDrop,
    accept: {
      'image/*': ['.jpeg', '.jpg', '.png', '.gif']
    },
    maxFiles: 1
  });

  // Function to verify base64 image data
  const verifyImageData = (dataUrl) => {
    // Check if it's a valid format
    if (!dataUrl || typeof dataUrl !== 'string') {
      return false;
    }
    
    // Check if it has valid data URL format
    if (!dataUrl.startsWith('data:image/')) {
      return false;
    }
    
    // Check for content
    const base64Content = dataUrl.split(',')[1];
    if (!base64Content || base64Content.length < 100) {
      return false;
    }
    
    return true;
  };

  const establishWebSocketConnection = () => {
    // Close existing connection if any
    if (socketRef.current) {
      socketRef.current.close();
    }

    const clientId = clientIdRef.current;
    const socket = new WebSocket(`${WS_URL}/ws/convert-to-ghibli/${clientId}`);
    socketRef.current = socket;

    socket.onopen = () => {
      console.log('WebSocket connection established');
      // Send the image data
      socket.send(JSON.stringify({ image: uploadedImage }));
    };

    socket.onmessage = (event) => {
      try {
        const data = JSON.parse(event.data);
        console.log('WebSocket message received:', data);

        if (data.status === 'processing') {
          setStatusMessage(data.message || 'Processing...');
          if (data.progress) {
            setProgress(data.progress);
          }
        } else if (data.status === 'complete') {
          if (data.result_image && verifyImageData(data.result_image)) {
            setConvertedImage(data.result_image);
            setProgress(100);
            setTimeout(() => setProgress(0), 1000);
            setLoading(false);
          } else {
            throw new Error('Invalid image data received');
          }
        } else if (data.status === 'error') {
          throw new Error(data.message || 'Error processing image');
        }
      } catch (err) {
        console.error('Error handling WebSocket message:', err);
        setError(err.message || 'Error processing the response from server');
        setLoading(false);
      }
    };

    socket.onerror = (error) => {
      console.error('WebSocket error:', error);
      setError('Connection error. Falling back to HTTP request...');
      
      // Fallback to HTTP if WebSocket fails
      handleConvertHttp();
    };

    socket.onclose = () => {
      console.log('WebSocket connection closed');
      socketRef.current = null;
    };

    return socket;
  };

  const handleConvertWebSocket = () => {
    if (!uploadedImage) {
      setError('Please upload an image first');
      return;
    }

    setLoading(true);
    setError('');
    setShowTips(false);
    setStatusMessage('Establishing connection...');
    setProgress(5);

    try {
      // Establish WebSocket connection and send the image
      establishWebSocketConnection();
    } catch (err) {
      console.error('Error setting up WebSocket:', err);
      setError('Failed to establish WebSocket connection. Falling back to HTTP request...');
      
      // Fallback to HTTP if WebSocket setup fails
      handleConvertHttp();
    }
  };

  // Original HTTP method as fallback
  const handleConvertHttp = async () => {
    if (!uploadedImage) {
      setError('Please upload an image first');
      return;
    }

    setLoading(true);
    setError('');
    setShowTips(false);
    setStatusMessage('Processing via HTTP...');

    try {
      // Convert the data URL to a File object
      const fetchRes = await fetch(uploadedImage);
      const blob = await fetchRes.blob();
      const file = new File([blob], 'image.png', { type: 'image/png' });
      
      // Create form data
      const formData = new FormData();
      formData.append('file', file);

      console.log('Sending image to API via HTTP...');
      
      // Send to API with timeout setting
      const response = await axios.post(`${API_URL}/convert-to-ghibli`, formData, {
        headers: {
          'Content-Type': 'multipart/form-data'
        },
        timeout: 120000 // 2 minute timeout for large images
      });

      console.log('Response received:', response.data);
      
      // Verify and set the converted image
      if (response.data && response.data.result_image) {
        if (verifyImageData(response.data.result_image)) {
          setConvertedImage(response.data.result_image);
        } else {
          throw new Error('Invalid image data received from the server');
        }
      } else {
        throw new Error('No image data received from the server');
      }
    } catch (err) {
      console.error('Error converting image:', err);
      if (err.response && err.response.status === 500) {
        setError('The server encountered an error processing your image. Please try a different image.');
      } else if (err.code === 'ECONNABORTED') {
        setError('The request timed out. The server may be overloaded or the image is too complex.');
      } else {
        setError(err.response?.data?.detail || err.message || 'Error converting image. Please try again.');
      }
    } finally {
      setLoading(false);
    }
  };

  const handleConvert = () => {
    // Try WebSocket first, with HTTP as fallback
    handleConvertWebSocket();
  };

  const handleReset = () => {
    setUploadedImage(null);
    setConvertedImage(null);
    setError('');
    setShowTips(false);
    setProgress(0);
    setStatusMessage('');
    
    // Close WebSocket if open
    if (socketRef.current && socketRef.current.readyState === WebSocket.OPEN) {
      socketRef.current.close();
      socketRef.current = null;
    }
  };

  return (
    <div className="image-uploader">
      <div className="upload-container">
        {!uploadedImage && (
          <div {...getRootProps()} className={`dropzone ${isDragActive ? 'active' : ''}`}>
            <input {...getInputProps()} />
            <div className="dropzone-content">
              <div className="upload-icon">
                <svg xmlns="http://www.w3.org/2000/svg" width="40" height="40" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                  <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"></path>
                  <polyline points="17 8 12 3 7 8"></polyline>
                  <line x1="12" y1="3" x2="12" y2="15"></line>
                </svg>
              </div>
              {isDragActive ? (
                <p>Drop your image here...</p>
              ) : (
                <>
                  <p>Drag & drop an image here, or click to select</p>
                  <span className="file-hint">JPEG, PNG, GIF (Max 10MB)</span>
                </>
              )}
            </div>
          </div>
        )}

        {uploadedImage && (
          <div className="preview original-preview">
            <h3>Original Image</h3>
            <div className="image-container">
              <img src={uploadedImage} alt="Uploaded preview" />
            </div>
            <div className="button-group">
              <button 
                onClick={handleConvert} 
                disabled={loading} 
                className="convert-button"
              >
                {loading ? 'Converting...' : 'Convert to Ghibli Style'}
              </button>
              <button 
                onClick={handleReset}
                className="reset-button"
                disabled={loading}
              >
                Reset
              </button>
            </div>
            
            {showTips && (
              <div className="tips-box">
                <h4>Tips for best results</h4>
                <ul>
                  <li>Use images with clear subjects</li>
                  <li>Avoid overly complex backgrounds</li>
                  <li>Images with people or landscapes work best</li>
                </ul>
              </div>
            )}
          </div>
        )}

        {convertedImage && (
          <div className="preview converted-preview">
            <h3>Ghibli Style Image</h3>
            <div className="image-container">
              <img 
                src={convertedImage} 
                alt="Converted to Ghibli style" 
                onError={(e) => {
                  console.error('Image failed to load');
                  setError('Generated image could not be displayed. Please try again.');
                }}
              />
            </div>
            <a 
              href={convertedImage} 
              download="ghibli-style-image.jpg" 
              className="download-button"
            >
              <span>Download</span>
              <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"></path>
                <polyline points="7 10 12 15 17 10"></polyline>
                <line x1="12" y1="15" x2="12" y2="3"></line>
              </svg>
            </a>
          </div>
        )}

        {error && <div className="error-message">{error}</div>}

        {loading && (
          <div className="loading">
            <div className="progress-bar">
              <div 
                className="progress-bar-fill" 
                style={{ width: `${progress}%` }}
              ></div>
            </div>
            <p>{statusMessage || 'Converting your image to Ghibli style...'}</p>
            {progress > 0 && (
              <div className="progress-percentage">{Math.round(progress)}%</div>
            )}
          </div>
        )}
      </div>
    </div>
  );
};

export default ImageUploader; 