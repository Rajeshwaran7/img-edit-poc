import React, { useEffect, useState } from 'react';
import ImageUploader from '../../components/ImageUploader';
import './Home.css';

const Home = () => {
  const [sparkles, setSparkles] = useState([]);
  
  useEffect(() => {
    // Create sparkle elements
    const generateSparkles = () => {
      const newSparkles = [];
      const sparkleCount = Math.floor(window.innerWidth / 50); // Responsive number of sparkles
      
      for (let i = 0; i < sparkleCount; i++) {
        newSparkles.push({
          id: i,
          left: `${Math.random() * 100}%`,
          top: `${Math.random() * 100}%`,
          size: `${Math.random() * 5 + 1}px`,
          animationDelay: `${Math.random() * 8}s`
        });
      }
      
      setSparkles(newSparkles);
    };
    
    generateSparkles();
    
    // Regenerate on window resize
    window.addEventListener('resize', generateSparkles);
    
    return () => {
      window.removeEventListener('resize', generateSparkles);
    };
  }, []);

  return (
    <div className="home">
      {/* Sparkle effects */}
      {sparkles.map((sparkle) => (
        <div
          key={sparkle.id}
          className="sparkle"
          style={{
            left: sparkle.left,
            top: sparkle.top,
            width: sparkle.size,
            height: sparkle.size,
            animationDelay: sparkle.animationDelay
          }}
        />
      ))}
      
      <header className="header">
        <h1>Ghibli Image Converter</h1>
        <p>Transform your ordinary photos into magical Studio Ghibli inspired artwork with our AI-powered converter</p>
      </header>
      
      <main>
        <ImageUploader />
      </main>
      
      <footer className="footer">
        <p>Powered by React and Hugging Face Diffusion Models</p>
      </footer>
    </div>
  );
};

export default Home; 