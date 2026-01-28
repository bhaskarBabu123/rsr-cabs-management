// src/context/LocationContext.jsx
import React, { createContext, useContext, useState, useEffect, useRef, useCallback } from 'react';
import toast from 'react-hot-toast';

const LocationContext = createContext(null);

export const useLocation = () => {
  const context = useContext(LocationContext);
  if (!context) {
    throw new Error('useLocation must be used within a LocationProvider');
  }
  return context;
};

export const LocationProvider = ({ children }) => {
  const [currentLocation, setCurrentLocation] = useState(null);
  const [isTracking, setIsTracking] = useState(false);
  const [locationError, setLocationError] = useState(null);
  const [accuracy, setAccuracy] = useState(null);
  const [altitude, setAltitude] = useState(null);
  const [speed, setSpeed] = useState(null);
  const [heading, setHeading] = useState(null);
  
  const watchIdRef = useRef(null);
  const locationHistoryRef = useRef([]);

  const startTracking = useCallback(() => {
    if (!navigator.geolocation) {
      const error = 'Geolocation is not supported by your browser';
      setLocationError(error);
      toast.error(error);
      return;
    }

    const options = {
      enableHighAccuracy: true,
      timeout: 10000,
      maximumAge: 0
    };

    const handleSuccess = (position) => {
      const locationData = {
        lat: position.coords.latitude,
        lng: position.coords.longitude,
        accuracy: position.coords.accuracy,
        altitude: position.coords.altitude,
        altitudeAccuracy: position.coords.altitudeAccuracy,
        heading: position.coords.heading,
        speed: position.coords.speed,
        timestamp: position.timestamp
      };

      setCurrentLocation(locationData);
      setAccuracy(position.coords.accuracy);
      setAltitude(position.coords.altitude);
      setSpeed(position.coords.speed);
      setHeading(position.coords.heading);
      setLocationError(null);
      setIsTracking(true);

      // Store in history
      locationHistoryRef.current.push(locationData);
      if (locationHistoryRef.current.length > 100) {
        locationHistoryRef.current.shift();
      }
    };

    const handleError = (error) => {
      let errorMessage = '';
      switch (error.code) {
        case error.PERMISSION_DENIED:
          errorMessage = 'Location permission denied. Please enable location access.';
          break;
        case error.POSITION_UNAVAILABLE:
          errorMessage = 'Location information unavailable.';
          break;
        case error.TIMEOUT:
          errorMessage = 'Location request timed out.';
          break;
        default:
          errorMessage = 'An unknown error occurred while getting location.';
      }
      setLocationError(errorMessage);
      setIsTracking(false);
      console.error('Location error:', errorMessage);
    };

    // Start watching position
    watchIdRef.current = navigator.geolocation.watchPosition(
      handleSuccess,
      handleError,
      options
    );

    // Get initial position immediately
    navigator.geolocation.getCurrentPosition(handleSuccess, handleError, options);
  }, []);

  const stopTracking = useCallback(() => {
    if (watchIdRef.current !== null) {
      navigator.geolocation.clearWatch(watchIdRef.current);
      watchIdRef.current = null;
    }
    setIsTracking(false);
  }, []);

  const getLocationHistory = useCallback(() => {
    return locationHistoryRef.current;
  }, []);

  const clearLocationHistory = useCallback(() => {
    locationHistoryRef.current = [];
  }, []);

  const getCurrentPosition = useCallback(() => {
    return new Promise((resolve, reject) => {
      if (!navigator.geolocation) {
        reject(new Error('Geolocation is not supported'));
        return;
      }

      navigator.geolocation.getCurrentPosition(
        (position) => {
          const location = {
            lat: position.coords.latitude,
            lng: position.coords.longitude,
            accuracy: position.coords.accuracy,
            speed: position.coords.speed,
            heading: position.coords.heading
          };
          resolve(location);
        },
        (error) => {
          reject(error);
        },
        {
          enableHighAccuracy: true,
          timeout: 10000,
          maximumAge: 0
        }
      );
    });
  }, []);

  // Cleanup on unmount
  useEffect(() => {
    return () => {
      if (watchIdRef.current !== null) {
        navigator.geolocation.clearWatch(watchIdRef.current);
      }
    };
  }, []);

  const value = {
    currentLocation,
    isTracking,
    locationError,
    accuracy,
    altitude,
    speed,
    heading,
    startTracking,
    stopTracking,
    getLocationHistory,
    clearLocationHistory,
    getCurrentPosition
  };

  return (
    <LocationContext.Provider value={value}>
      {children}
    </LocationContext.Provider>
  );
};

export default LocationContext;