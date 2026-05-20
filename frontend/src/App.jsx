import React, { useState, useEffect, useRef } from 'react';

const API_BASE = import.meta.env.DEV
  ? 'http://localhost:5000/api'
  : '/_/backend/api';

// Regular expression to validate standard and short YouTube URLs
const YOUTUBE_REGEX = /^(https?:\/\/)?(www\.)?(youtube\.com|youtu\.be)\/(watch\?v=|embed\/|v\/|.+\?v=)?([^&=%\?]{11})/;

export default function App() {
  const [url, setUrl] = useState('');
  const [loadingInfo, setLoadingInfo] = useState(false);
  const [videoInfo, setVideoInfo] = useState(null);
  const [error, setError] = useState(null);
  const [downloadTaskId, setDownloadTaskId] = useState(null);
  const [progress, setProgress] = useState(null);
  const [selectedFormat, setSelectedFormat] = useState('m4a'); // 'm4a' or 'mp3'
  
  const pollingRef = useRef(null);

  // Auto-fetch metadata if URL matches YouTube regex
  useEffect(() => {
    const match = url.match(YOUTUBE_REGEX);
    if (match) {
      const delayDebounce = setTimeout(() => {
        fetchVideoInfo(url);
      }, 500);
      return () => clearTimeout(delayDebounce);
    } else {
      if (!url.trim()) {
        setVideoInfo(null);
        setError(null);
      }
    }
  }, [url]);

  // Clean up polling on unmount
  useEffect(() => {
    return () => {
      if (pollingRef.current) clearInterval(pollingRef.current);
    };
  }, []);

  const fetchVideoInfo = async (targetUrl) => {
    setLoadingInfo(true);
    setError(null);
    setVideoInfo(null);

    try {
      const response = await fetch(`${API_BASE}/info?url=${encodeURIComponent(targetUrl)}`);
      const data = await response.json();

      if (!response.ok) {
        throw new Error(data.error || 'No se pudo obtener la información del video.');
      }

      setVideoInfo(data);
    } catch (err) {
      setError(err.message);
    } finally {
      setLoadingInfo(false);
    }
  };

  const handleManualSearch = (e) => {
    e.preventDefault();
    if (!url.trim()) return;
    
    if (!YOUTUBE_REGEX.test(url)) {
      setError('Por favor, ingresa un enlace válido de YouTube.');
      return;
    }
    fetchVideoInfo(url);
  };

  const startDownload = async () => {
    if (!videoInfo) return;
    setError(null);
    setProgress({ status: 'starting', percent: 0, speed: '0 KiB/s', eta: '--:--' });

    try {
      const response = await fetch(`${API_BASE}/download/start`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ url: videoInfo.webpageUrl, format: selectedFormat })
      });
      const data = await response.json();

      if (!response.ok) {
        throw new Error(data.error || 'Error al iniciar la descarga.');
      }

      setDownloadTaskId(data.taskId);
      startPolling(data.taskId);
    } catch (err) {
      setError(err.message);
      setProgress(null);
    }
  };

  const startPolling = (taskId) => {
    if (pollingRef.current) clearInterval(pollingRef.current);

    pollingRef.current = setInterval(async () => {
      try {
        const response = await fetch(`${API_BASE}/download/progress/${taskId}`);
        if (!response.ok) {
          throw new Error('Error al obtener el estado de la descarga.');
        }
        const data = await response.json();
        setProgress(data);

        if (data.status === 'completed') {
          clearInterval(pollingRef.current);
          triggerFileDownload(taskId);
        } else if (data.status === 'failed') {
          clearInterval(pollingRef.current);
          setError(data.error || 'La descarga falló en el servidor.');
          setDownloadTaskId(null);
        }
      } catch (err) {
        console.error('Polling error:', err);
      }
    }, 800);
  };

  const triggerFileDownload = (taskId) => {
    const titleParam = encodeURIComponent(videoInfo.title);
    const downloadUrl = `${API_BASE}/download/file/${taskId}?title=${titleParam}`;

    const link = document.createElement('a');
    link.href = downloadUrl;
    link.setAttribute('download', '');
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);

    setTimeout(() => {
      setProgress(null);
      setDownloadTaskId(null);
    }, 4000);
  };

  const formatDuration = (seconds) => {
    if (!seconds) return '00:00';
    const hrs = Math.floor(seconds / 3600);
    const mins = Math.floor((seconds % 3600) / 60);
    const secs = seconds % 60;
    
    if (hrs > 0) {
      return `${hrs}:${mins.toString().padStart(2, '0')}:${secs.toString().padStart(2, '0')}`;
    }
    return `${mins}:${secs.toString().padStart(2, '0')}`;
  };

  const formatViews = (views) => {
    if (!views) return '0';
    if (views >= 1000000) {
      return (views / 1000000).toFixed(1) + ' M';
    }
    if (views >= 1000) {
      return (views / 1000).toFixed(1) + ' K';
    }
    return views.toString();
  };

  return (
    <div className="app-container">
      {/* Header */}
      <header className="app-header">
        <div className="logo-wrapper">
          <div className="logo-icon">
            <svg viewBox="0 0 24 24">
              <path d="M12 2C6.48 2 2 6.48 2 12s4.48 10 10 10 10-4.48 10-10S17.52 2 12 2zm-2 14.5v-9l6 4.5-6 4.5z"/>
            </svg>
          </div>
          <h1 className="logo-text">SonicTube</h1>
        </div>
        <p className="tagline">
          Descarga el audio de tus videos de YouTube de forma nativa en alta calidad sin pérdidas o conviértelo a MP3 al instante.
        </p>
      </header>

      {/* Main Card */}
      <main className="main-card">
        {/* Form Input */}
        <form onSubmit={handleManualSearch} className="input-section">
          <label className="input-label">Pega el enlace del video</label>
          <div className="input-wrapper">
            <input
              type="text"
              placeholder="https://www.youtube.com/watch?v=..."
              value={url}
              onChange={(e) => setUrl(e.target.value)}
              className="input-field"
              disabled={progress && progress.status !== 'completed'}
            />
            <svg className="input-icon" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13.828 10.172a4 4 0 00-5.656 0l-4 4a4 4 0 105.656 5.656l1.102-1.101m-.758-4.899a4 4 0 005.656 0l4-4a4 4 0 00-5.656-5.656l-1.1 1.1" />
            </svg>
          </div>
          
          {!videoInfo && !loadingInfo && (
            <button
              type="submit"
              className="submit-btn"
              disabled={!url.trim() || (progress && progress.status !== 'completed')}
            >
              Buscar Video
            </button>
          )}
        </form>

        {/* Error Alert */}
        {error && (
          <div className="error-box">
            <svg viewBox="0 0 24 24">
              <path d="M12 2C6.48 2 2 6.48 2 12s4.48 10 10 10 10-4.48 10-10S17.52 2 12 2zm1 15h-2v-2h2v2zm0-4h-2V7h2v6z" />
            </svg>
            <div>{error}</div>
          </div>
        )}

        {/* Skeleton Loader while fetching video details */}
        {loadingInfo && (
          <div className="preview-card">
            <div className="preview-grid">
              <div className="skeleton skeleton-thumbnail"></div>
              <div className="video-info">
                <div>
                  <div className="skeleton skeleton-title"></div>
                  <div className="skeleton skeleton-title" style={{ width: '60%' }}></div>
                  <div className="skeleton skeleton-channel"></div>
                </div>
                <div className="skeleton skeleton-stats"></div>
              </div>
            </div>
          </div>
        )}

        {/* Video Preview Card */}
        {videoInfo && !loadingInfo && (
          <div className="preview-card">
            <div className="preview-grid">
              <div className="thumbnail-wrapper">
                <img
                  src={videoInfo.thumbnail}
                  alt={videoInfo.title}
                  className="thumbnail-img"
                  onError={(e) => {
                    e.target.onerror = null;
                    e.target.src = 'https://images.unsplash.com/photo-1611162617213-7d7a39e9b1d7?w=300&q=80';
                  }}
                />
                <span className="duration-badge">{formatDuration(videoInfo.duration)}</span>
              </div>
              
              <div className="video-info">
                <div>
                  <h3 className="video-title" title={videoInfo.title}>{videoInfo.title}</h3>
                  <div className="video-channel">
                    <svg viewBox="0 0 24 24">
                      <path d="M12 2C6.48 2 2 6.48 2 12s4.48 10 10 10 10-4.48 10-10S17.52 2 12 2zm-2 15l-5-5 1.41-1.41L10 14.17l7.59-7.59L19 8l-9 9z"/>
                    </svg>
                    <span>{videoInfo.uploader}</span>
                  </div>
                </div>
                <div className="stats-row">
                  <span>{formatViews(videoInfo.viewCount)} vistas</span>
                </div>
              </div>
            </div>

            {/* Action Panel */}
            <div className="action-panel">
              {!progress ? (
                <>
                  <div className="format-selector">
                    <span className="selector-title">Formato de Audio</span>
                    <div className="format-options">
                      <div 
                        className={`format-option-card ${selectedFormat === 'm4a' ? 'selected' : ''}`}
                        onClick={() => setSelectedFormat('m4a')}
                      >
                        <div className="radio-circle"></div>
                        <div className="option-details">
                          <span className="option-name">AAC / M4A (Original Directo)</span>
                          <span className="option-desc">Excelente fidelidad, sin re-compresión, descarga instantánea. Recomendado.</span>
                        </div>
                      </div>

                      <div 
                        className={`format-option-card ${selectedFormat === 'mp3' ? 'selected' : ''}`}
                        onClick={() => setSelectedFormat('mp3')}
                      >
                        <div className="radio-circle"></div>
                        <div className="option-details">
                          <span className="option-name">MP3 (Conversión de Audio)</span>
                          <span className="option-desc">Compatibilidad absoluta con reproductores antiguos, convertido a 250kbps VBR.</span>
                        </div>
                      </div>
                    </div>
                  </div>
                  <button onClick={startDownload} className="download-trigger-btn">
                    <svg style={{ width: '1.25rem', height: '1.25rem', fill: 'currentColor' }} viewBox="0 0 24 24">
                      <path d="M19.35 10.04C18.67 6.59 15.64 4 12 4 9.11 4 6.6 5.64 5.35 8.04 2.34 8.36 0 10.91 0 14c0 3.31 2.69 6 6 6h13c2.76 0 5-2.24 5-5 0-2.64-2.05-4.78-4.65-4.96zM17 13l-5 5-5-5h3V9h4v4h3z"/>
                    </svg>
                    Descargar Audio en {selectedFormat.toUpperCase()}
                  </button>
                </>
              ) : (
                <div className="progress-container">
                  <div className="progress-header">
                    <span className="progress-title-text">
                      {progress.status === 'starting' && 'Iniciando descarga...'}
                      {progress.status === 'downloading' && 'Descargando audio de YouTube...'}
                      {progress.status === 'converting' && (selectedFormat === 'mp3' ? 'Convirtiendo y extrayendo MP3...' : 'Optimizando formato M4A...')}
                      {progress.status === 'completed' && '¡Completado! Descargando archivo...'}
                      {progress.status === 'failed' && 'Error en la descarga'}
                    </span>
                    <span className="progress-percentage">{Math.round(progress.percent)}%</span>
                  </div>

                  <div className="progress-track">
                    <div
                      className="progress-fill"
                      style={{ width: `${progress.percent}%` }}
                    ></div>
                  </div>

                  <div className="progress-footer">
                    <div className="progress-meta-item">
                      <span className={`status-badge ${progress.status}`}>
                        {progress.status === 'starting' && 'Iniciando'}
                        {progress.status === 'downloading' && 'Procesando'}
                        {progress.status === 'converting' && 'Conversión'}
                        {progress.status === 'completed' && 'Listo'}
                        {progress.status === 'failed' && 'Fallo'}
                      </span>
                    </div>
                    {progress.status === 'downloading' && (
                      <div style={{ display: 'flex', gap: '1rem' }}>
                        <span>Velocidad: <strong>{progress.speed}</strong></span>
                        <span>Restante: <strong>{progress.eta}</strong></span>
                      </div>
                    )}
                  </div>
                </div>
              )}
            </div>
          </div>
        )}
      </main>

      {/* Features Showcase */}
      <section className="features-section">
        <h2 className="section-title">¿Por qué elegir SonicTube?</h2>
        <div className="features-grid">
          <div className="feature-card">
            <div className="feature-icon-box">
              <svg viewBox="0 0 24 24">
                <path d="M12 3v10.55c-.59-.34-1.27-.55-2-.55-2.21 0-4 1.79-4 4s1.79 4 4 4 4-1.79 4-4V7h4V3h-6z" />
              </svg>
            </div>
            <h3 className="feature-title">Calidad Original o MP3</h3>
            <p className="feature-desc">
              Descarga en formato M4A sin pérdidas de recodificación o convierte a MP3 premium a 250 kbps en segundos gracias al motor FFmpeg incorporado.
            </p>
          </div>

          <div className="feature-card">
            <div className="feature-icon-box">
              <svg viewBox="0 0 24 24">
                <path d="M12 2C6.48 2 2 6.48 2 12s4.48 10 10 10 10-4.48 10-10S17.52 2 12 2zm1 15h-2v-6h2v6zm0-8h-2V7h2v2z"/>
              </svg>
            </div>
            <h3 className="feature-title">Sin Instalación Local</h3>
            <p className="feature-desc">
              No requieres descargar extensiones sospechosas ni configurar dependencias complejas. La aplicación se encarga de todo de forma automática.
            </p>
          </div>

          <div className="feature-card">
            <div className="feature-icon-box">
              <svg viewBox="0 0 24 24">
                <path d="M12 2C6.48 2 2 6.48 2 12s4.48 10 10 10 10-4.48 10-10S17.52 2 12 2zm-1 17.93c-3.95-.49-7-3.85-7-7.93 0-.62.08-1.21.21-1.79L9 15v1c0 1.1.9 2 2 2v1.93zm6.9-2.54c-.26-.81-1-1.39-1.9-1.39h-1v-3c0-.55-.45-1-1-1H8v-2h2c.55 0 1-.45 1-1V7h2c1.1 0 2-.9 2-2v-.41c2.93 1.19 5 4.06 5 7.41 0 2.08-.8 3.97-2.1 5.39z"/>
              </svg>
            </div>
            <h3 className="feature-title">Alta Compatibilidad</h3>
            <p className="feature-desc">
              Tanto el formato M4A (AAC) como MP3 funcionan de forma nativa en Android, iOS (iPhone), macOS, Windows y reproductores de auto.
            </p>
          </div>
        </div>
      </section>

      {/* Footer */}
      <footer className="app-footer">
        <p>&copy; {new Date().getFullYear()} SonicTube. Desarrollado con tecnología de punta.</p>
        <p style={{ marginTop: '0.5rem', fontSize: '0.75rem' }}>
          Este software fue diseñado para uso personal. Respeta los términos de servicio y derechos de autor correspondientes.
        </p>
      </footer>
    </div>
  );
}
