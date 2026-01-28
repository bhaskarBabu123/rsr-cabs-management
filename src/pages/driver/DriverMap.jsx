// src/pages/driver/DriverMap.jsx
import React, { useState, useEffect, useRef, useCallback } from 'react';
import {
  Navigation,
  MapPin,
  Clock,
  Phone,
  AlertCircle,
  Check,
  User,
  Home,
  Building2,
  Locate,
  TrendingUp,
  ChevronDown,
  ChevronUp,
  Info,
  X,
  ArrowUp,
  ArrowRight,
  ArrowLeft
} from 'lucide-react';
import DriverLayout from '../../components/layouts/DriverLayout';
import LoadingSpinner from '../../components/LoadingSpinner';
import { useLocation } from '../../context/LocationContext';
import { useSocket } from '../../context/SocketContext';
import { tripAPI, locationAPI, driverAPI } from '../../services/api';
import { GoogleMap, Marker, DirectionsRenderer, Polyline, InfoWindow, Circle } from '@react-google-maps/api';
import toast from 'react-hot-toast';

const mapContainerStyle = {
  width: '100%',
  height: '100%'
};

// Minimal map styles - clean Google Maps look
const customMapStyles = [
  {
    featureType: 'poi',
    elementType: 'labels.text',
    stylers: [{ visibility: 'on' }]
  },
  {
    featureType: 'poi.business',
    stylers: [{ visibility: 'simplified' }]
  },
  {
    featureType: 'transit',
    elementType: 'labels',
    stylers: [{ visibility: 'on' }]
  },
  {
    featureType: 'road',
    elementType: 'labels',
    stylers: [{ visibility: 'on' }]
  },
  {
    featureType: 'administrative',
    elementType: 'labels',
    stylers: [{ visibility: 'on' }]
  }
];

// Compact bottom sheet heights
const SHEET_HEIGHTS = {
  MIN: 120,
  MIDDLE: 340,
  MAX: window.innerHeight * 0.65
};

// Custom car icon SVG
const CAR_ICON_SVG = `
  <svg width="48" height="48" viewBox="0 0 48 48" xmlns="http://www.w3.org/2000/svg">
    <!-- Outer circle (white border) -->
    <circle cx="24" cy="24" r="22" fill="white" stroke="#E5E7EB" stroke-width="2"/>
    <!-- Inner circle (blue background) -->
    <circle cx="24" cy="24" r="18" fill="#4F46E5"/>
    <!-- Navigation arrow -->
    <path d="M24 8 L28 18 L24 16 L20 18 Z" fill="white"/>
    <!-- Car icon -->
    <path d="M24 20 L26 24 L22 24 Z M22 24 L26 24 L26 28 L22 28 Z M20 26 L21 26 L21 27 L20 27 Z M27 26 L28 26 L28 27 L27 27 Z" fill="white"/>
  </svg>
`;

const DriverMap = () => {
  const [trip, setTrip] = useState(null);
  const [isLoading, setIsLoading] = useState(true);
  const [directionsResponse, setDirectionsResponse] = useState(null);
  const [currentStepIndex, setCurrentStepIndex] = useState(0);
  const [routeSteps, setRouteSteps] = useState([]);
  const [eta, setEta] = useState('--');
  const [distance, setDistance] = useState('--');
  const [nextStopInstructions, setNextStopInstructions] = useState('');
  const [currentSpeed, setCurrentSpeed] = useState(0);
  const [locationHistory, setLocationHistory] = useState([]);
  const [estimatedArrival, setEstimatedArrival] = useState('');
  const [trafficCondition, setTrafficCondition] = useState('normal');
  const [bearing, setBearing] = useState(0);
  const [sheetHeight, setSheetHeight] = useState(SHEET_HEIGHTS.MIDDLE);
  const [isDragging, setIsDragging] = useState(false);
  const [selectedMarker, setSelectedMarker] = useState(null);
  const [showRouteInfo, setShowRouteInfo] = useState(false);
  const [totalTripDistance, setTotalTripDistance] = useState(0);
  const [completedDistance, setCompletedDistance] = useState(0);
  const [distanceToNextTurn, setDistanceToNextTurn] = useState('');
  const [isNavigationMode, setIsNavigationMode] = useState(true);

  const { currentLocation, isTracking, startTracking, stopTracking } = useLocation();
  const { socket, sendLocationUpdate } = useSocket();
  const mapRef = useRef(null);
  const locationUpdateInterval = useRef(null);
  const routeRecalculationInterval = useRef(null);
  const previousLocation = useRef(null);
  const sheetRef = useRef(null);
  const startY = useRef(0);
  const startHeight = useRef(0);

  // Fetch active trip on mount
  useEffect(() => {
    const initialize = async () => {
      await fetchActiveTrip();
      if (!isTracking) {
        startTracking();
      }
    };
    initialize();

    return () => {
      if (isTracking) stopTracking();
      if (locationUpdateInterval.current) {
        clearInterval(locationUpdateInterval.current);
      }
      if (routeRecalculationInterval.current) {
        clearInterval(routeRecalculationInterval.current);
      }
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const fetchActiveTrip = async () => {
    try {
      const res = await driverAPI.getTrips({ status: 'active', limit: 1 });
      const activeTrips = res.data.trips || [];
      if (activeTrips.length > 0) {
        const fetchedTrip = activeTrips[0];
        setTrip(fetchedTrip);
        generateRouteSteps(fetchedTrip);
      } else {
        setTrip(null);
        setRouteSteps([]);
      }
    } catch (err) {
      console.error(err);
      toast.error('Failed to load your trip');
      setTrip(null);
    } finally {
      setIsLoading(false);
    }
  };

  const generateRouteSteps = (tripData) => {
    const steps = [];

    if (tripData.tripType === 'login') {
      tripData.employees.forEach(emp => {
        steps.push({
          type: 'pickup',
          employee: emp.employee,
          location: emp.pickupLocation,
          status: emp.status,
          completed: emp.status === 'picked_up' || emp.status === 'dropped'
        });
      });
      steps.push({
        type: 'office_drop',
        location: tripData.officeLocation,
        completed: false,
        label: 'Office Drop-off'
      });
    } else {
      steps.push({
        type: 'office_pickup',
        location: tripData.officeLocation,
        completed: false,
        label: 'Office Pickup'
      });
      tripData.employees.forEach(emp => {
        steps.push({
          type: 'drop',
          employee: emp.employee,
          location: emp.dropLocation,
          status: emp.status,
          completed: emp.status === 'dropped'
        });
      });
    }

    setRouteSteps(steps);
    const firstPending = steps.findIndex(s => !s.completed);
    setCurrentStepIndex(firstPending === -1 ? 0 : firstPending);
  };

  // Calculate bearing between two points
  const calculateBearing = (start, end) => {
    const startLat = (start.lat * Math.PI) / 180;
    const startLng = (start.lng * Math.PI) / 180;
    const endLat = (end.lat * Math.PI) / 180;
    const endLng = (end.lng * Math.PI) / 180;

    const dLng = endLng - startLng;
    const y = Math.sin(dLng) * Math.cos(endLat);
    const x = Math.cos(startLat) * Math.sin(endLat) - Math.sin(startLat) * Math.cos(endLat) * Math.cos(dLng);
    const bearing = (Math.atan2(y, x) * 180) / Math.PI;

    return (bearing + 360) % 360;
  };

  // Calculate distance between two points (Haversine formula)
  const calculateDistance = (lat1, lon1, lat2, lon2) => {
    const R = 6371;
    const dLat = ((lat2 - lat1) * Math.PI) / 180;
    const dLon = ((lon2 - lon1) * Math.PI) / 180;
    const a =
      Math.sin(dLat / 2) * Math.sin(dLat / 2) +
      Math.cos((lat1 * Math.PI) / 180) *
        Math.cos((lat2 * Math.PI) / 180) *
        Math.sin(dLon / 2) *
        Math.sin(dLon / 2);
    const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
    return R * c;
  };

  // Get maneuver icon
  const getManeuverIcon = (instruction) => {
    if (!instruction) return ArrowUp;
    const lower = instruction.toLowerCase();
    if (lower.includes('right')) return ArrowRight;
    if (lower.includes('left')) return   ArrowLeft;
    return ArrowUp;
  };

  // Auto-send location updates every 5 seconds
  useEffect(() => {
    if (!currentLocation || !trip) return;

    const sendLocation = async () => {
      const locationData = {
        tripId: trip._id,
        location: {
          coordinates: {
            lat: currentLocation.lat,
            lng: currentLocation.lng
          },
          speed: currentLocation.speed || 0,
          bearing: bearing,
          accuracy: currentLocation.accuracy || 0,
          timestamp: new Date().toISOString()
        }
      };

      try {
        if (socket) {
          sendLocationUpdate(trip._id, locationData.location);
        }
        
        await locationAPI.updateLocation(locationData);
        
        setLocationHistory(prev => {
          const updated = [...prev, currentLocation];
          return updated.slice(-100);
        });

        if (previousLocation.current) {
          const newBearing = calculateBearing(previousLocation.current, currentLocation);
          setBearing(newBearing);
          
          if (currentLocation.speed !== undefined && currentLocation.speed !== null) {
            setCurrentSpeed(Math.round(currentLocation.speed * 3.6));
          }

          const distanceTraveled = calculateDistance(
            previousLocation.current.lat,
            previousLocation.current.lng,
            currentLocation.lat,
            currentLocation.lng
          );
          setCompletedDistance(prev => prev + distanceTraveled);
        }
        previousLocation.current = currentLocation;
      } catch (error) {
        console.error('Location update failed:', error);
      }
    };

    sendLocation();
    locationUpdateInterval.current = setInterval(sendLocation, 5000);

    return () => {
      if (locationUpdateInterval.current) {
        clearInterval(locationUpdateInterval.current);
      }
    };
  }, [currentLocation, trip, socket, sendLocationUpdate, bearing]);

  // Calculate route & ETA with navigation
  const calculateRoute = useCallback(() => {
    if (!currentLocation || routeSteps.length === 0 || !window.google) return;

    const directionsService = new window.google.maps.DirectionsService();
    const nextStop = routeSteps[currentStepIndex];
    if (!nextStop?.location?.coordinates) return;

    const waypoints = [];
    
    for (let i = currentStepIndex + 1; i < Math.min(currentStepIndex + 3, routeSteps.length); i++) {
      if (routeSteps[i]?.location?.coordinates) {
        waypoints.push({
          location: routeSteps[i].location.coordinates,
          stopover: true
        });
      }
    }

    const request = {
      origin: { lat: currentLocation.lat, lng: currentLocation.lng },
      destination: nextStop.location.coordinates,
      waypoints: waypoints.length > 0 ? waypoints : undefined,
      optimizeWaypoints: true,
      travelMode: window.google.maps.TravelMode.DRIVING,
      drivingOptions: {
        departureTime: new Date(),
        trafficModel: 'bestguess'
      },
      provideRouteAlternatives: false
    };

    directionsService.route(request, (result, status) => {
      if (status === 'OK') {
        setDirectionsResponse(result);
        const leg = result.routes[0].legs[0];
        setDistance(leg.distance.text);
        setEta(leg.duration.text);
        
        let totalDist = 0;
        result.routes[0].legs.forEach(l => {
          totalDist += l.distance.value / 1000;
        });
        setTotalTripDistance(totalDist);
        
        const etaMinutes = Math.round(leg.duration.value / 60);
        const arrivalTime = new Date(Date.now() + etaMinutes * 60000);
        setEstimatedArrival(arrivalTime.toLocaleTimeString('en-US', { 
          hour: 'numeric', 
          minute: '2-digit',
          hour12: true 
        }));

        if (leg.duration_in_traffic) {
          const trafficRatio = leg.duration_in_traffic.value / leg.duration.value;
          if (trafficRatio > 1.5) {
            setTrafficCondition('heavy');
          } else if (trafficRatio > 1.2) {
            setTrafficCondition('moderate');
          } else {
            setTrafficCondition('light');
          }
        }

        if (leg.steps && leg.steps.length > 0) {
          const currentStep = leg.steps[0];
          setNextStopInstructions(currentStep.instructions);
          setDistanceToNextTurn(currentStep.distance.text);
        }

        if (mapRef.current && isNavigationMode) {
          mapRef.current.panTo({ lat: currentLocation.lat, lng: currentLocation.lng });
          mapRef.current.setZoom(18);
          mapRef.current.setHeading(bearing);
          mapRef.current.setTilt(50);
        }
      } else {
        console.error('Directions request failed:', status);
      }
    });
  }, [currentLocation, routeSteps, currentStepIndex, bearing, isNavigationMode]);

  useEffect(() => {
    if (trip && routeSteps.length > 0 && currentLocation) {
      calculateRoute();
      
      routeRecalculationInterval.current = setInterval(() => {
        calculateRoute();
      }, 10000);

      return () => {
        if (routeRecalculationInterval.current) {
          clearInterval(routeRecalculationInterval.current);
        }
      };
    }
  }, [trip, routeSteps, calculateRoute, currentLocation]);

  const markCurrentStepCompleted = async () => {
    if (!trip || currentStepIndex >= routeSteps.length) return;
    const currentStep = routeSteps[currentStepIndex];

    let newStatus = '';
    if (currentStep.type === 'pickup' || currentStep.type === 'office_pickup') {
      newStatus = 'picked_up';
    } else if (currentStep.type === 'drop' || currentStep.type === 'office_drop') {
      newStatus = 'dropped';
    }

    const employeeId = currentStep.employee?._id;

    try {
      if (employeeId) {
        await tripAPI.updateEmployeeStatus(trip._id, employeeId, { status: newStatus });
      }

      const updatedSteps = [...routeSteps];
      updatedSteps[currentStepIndex].completed = true;
      updatedSteps[currentStepIndex].status = newStatus;
      setRouteSteps(updatedSteps);

      toast.success(`${currentStep.type === 'pickup' || currentStep.type === 'office_pickup' ? 'Pickup' : 'Drop-off'} completed`, {
        icon: '✅',
        duration: 2000
      });

      if (currentStepIndex < routeSteps.length - 1) {
        setCurrentStepIndex(currentStepIndex + 1);
        setTimeout(() => calculateRoute(), 500);
      } else {
        await tripAPI.complete(trip._id, { 
          actualDistance: completedDistance,
          completedAt: new Date().toISOString()
        });
        toast.success('🎉 Trip completed successfully!', { duration: 3000 });
        fetchActiveTrip();
        setDirectionsResponse(null);
        setCompletedDistance(0);
      }
    } catch (err) {
      toast.error('Failed to update status. Please try again.');
      console.error(err);
    }
  };

  // Bottom sheet drag handlers
  const handleTouchStart = (e) => {
    setIsDragging(true);
    startY.current = e.touches[0].clientY;
    startHeight.current = sheetHeight;
  };

  const handleTouchMove = (e) => {
    if (!isDragging) return;
    
    const currentY = e.touches[0].clientY;
    const diff = startY.current - currentY;
    let newHeight = startHeight.current + diff;

    newHeight = Math.max(SHEET_HEIGHTS.MIN, Math.min(SHEET_HEIGHTS.MAX, newHeight));
    setSheetHeight(newHeight);
  };

  const handleTouchEnd = () => {
    setIsDragging(false);
    
    if (sheetHeight < SHEET_HEIGHTS.MIN + 30) {
      setSheetHeight(SHEET_HEIGHTS.MIN);
    } else if (sheetHeight < SHEET_HEIGHTS.MIDDLE + 60) {
      setSheetHeight(SHEET_HEIGHTS.MIDDLE);
    } else {
      setSheetHeight(SHEET_HEIGHTS.MAX);
    }
  };

  const onMapLoad = useCallback((map) => {
    mapRef.current = map;
  }, []);

  const handleRecenter = () => {
    if (mapRef.current && currentLocation) {
      setIsNavigationMode(true);
      mapRef.current.panTo({ lat: currentLocation.lat, lng: currentLocation.lng });
      mapRef.current.setZoom(18);
      mapRef.current.setHeading(bearing);
      mapRef.current.setTilt(50);
    }
  };

  const handleCallEmployee = () => {
    const nextStep = routeSteps[currentStepIndex];
    if (nextStep?.employee?.user?.phone) {
      window.location.href = `tel:${nextStep.employee.user.phone}`;
    } else {
      toast.error('Phone number not available');
    }
  };

  const handleEmergency = () => {
    if (socket && trip && currentLocation) {
      sendLocationUpdate(trip._id, {
        coordinates: currentLocation,
        emergency: true,
        timestamp: new Date().toISOString()
      });
      toast.error('🚨 Emergency alert sent!', { duration: 3000 });
    }
  };

  const getStepIcon = (step) => {
    if (step.type === 'pickup') return '📍';
    if (step.type === 'drop') return '🏠';
    if (step.type === 'office_drop' || step.type === 'office_pickup') return '🏢';
    return '📍';
  };

  const nextStep = routeSteps[currentStepIndex];
  const center = currentLocation || { lat: 13.0405451, lng: 77.5897363 };
  const progressPercentage = routeSteps.length > 0 
    ? ((routeSteps.filter(s => s.completed).length / routeSteps.length) * 100).toFixed(0)
    : 0;
  
  const remainingStops = routeSteps.length > 0 ? routeSteps.slice(currentStepIndex + 1).length : 0;

  const ManeuverIcon = getManeuverIcon(nextStopInstructions);

  if (isLoading) {
    return (
      <DriverLayout>
        <div className="flex flex-col justify-center items-center h-[80vh] gap-4">
          <LoadingSpinner size="lg" />
          <p className="text-xs text-gray-500">Loading your trip...</p>
        </div>
      </DriverLayout>
    );
  }

  return (
    <DriverLayout>
      <div className="h-[calc(100vh-64px)] w-full relative bg-gray-50">
        {/* Map Area */}
        <div className="absolute inset-0">
          <GoogleMap
            mapContainerStyle={mapContainerStyle}
            center={center}
            zoom={isNavigationMode ? 18 : 15}
            heading={isNavigationMode ? bearing : 0}
            tilt={isNavigationMode ? 50 : 0}
            onLoad={onMapLoad}
            onDragStart={() => setIsNavigationMode(false)}
            options={{
              disableDefaultUI: true,
              zoomControl: false,
              streetViewControl: false,
              mapTypeControl: false,
              fullscreenControl: false,
              styles: customMapStyles,
              gestureHandling: 'greedy',
              mapTypeId: 'roadmap'
            }}
          >
            {/* Route line */}
            {directionsResponse && (
              <DirectionsRenderer
                directions={directionsResponse}
                options={{
                  suppressMarkers: true,
                  preserveViewport: isNavigationMode,
                  polylineOptions: {
                    strokeColor: '#5B8DEF',
                    strokeWeight: 6,
                    strokeOpacity: 0.9
                  }
                }}
              />
            )}

            {/* Location trail */}
            {locationHistory.length > 1 && (
              <Polyline
                path={locationHistory}
                options={{
                  strokeColor: '#93C5FD',
                  strokeWeight: 4,
                  strokeOpacity: 0.5,
                  geodesic: true
                }}
              />
            )}

            {/* Current location - Google Maps style circular car marker */}
            {currentLocation && (
              <>
                {/* Accuracy circle */}
                <Circle
                  center={currentLocation}
                  radius={currentLocation.accuracy || 10}
                  options={{
                    fillColor: '#4F46E5',
                    fillOpacity: 0.1,
                    strokeColor: '#4F46E5',
                    strokeOpacity: 0.3,
                    strokeWeight: 1
                  }}
                />
                
                {/* Car marker with circular background */}
                <Marker
                  position={currentLocation}
                  icon={{
                    url: 'data:image/svg+xml;charset=UTF-8,' + encodeURIComponent(`
                      <svg width="48" height="48" viewBox="0 0 48 48" xmlns="http://www.w3.org/2000/svg">
                        <defs>
                          <filter id="shadow" x="-50%" y="-50%" width="200%" height="200%">
                            <feDropShadow dx="0" dy="2" stdDeviation="2" flood-opacity="0.3"/>
                          </filter>
                        </defs>
                        <circle cx="24" cy="24" r="20" fill="white" filter="url(#shadow)"/>
                        <circle cx="24" cy="24" r="18" fill="#4F46E5"/>
                        <g transform="rotate(${bearing} 24 24)">
                          <path d="M24 10 L27 20 L24 18 L21 20 Z" fill="white"/>
                        </g>
                        <circle cx="24" cy="24" r="4" fill="white"/>
                      </svg>
                    `),
                    scaledSize: new window.google.maps.Size(48, 48),
                    anchor: new window.google.maps.Point(24, 24)
                  }}
                  zIndex={1000}
                />
              </>
            )}

            {/* Pickup/Drop markers with custom icons */}
            {routeSteps.map((step, idx) => {
              const isActive = idx === currentStepIndex;
              const isPast = step.completed;
              const isPickup = step.type === 'pickup' || step.type === 'office_pickup';
              
              return (
                <Marker
                  key={idx}
                  position={step.location.coordinates}
                  onClick={() => setSelectedMarker(idx)}
                  icon={{
                    url: 'data:image/svg+xml;charset=UTF-8,' + encodeURIComponent(`
                      <svg width="32" height="40" viewBox="0 0 32 40" xmlns="http://www.w3.org/2000/svg">
                        <path d="M16 0C7.2 0 0 7.2 0 16c0 12 16 24 16 24s16-12 16-24c0-8.8-7.2-16-16-16z" 
                          fill="${isPast ? '#10B981' : isActive ? '#EF4444' : '#6B7280'}"/>
                        <circle cx="16" cy="16" r="10" fill="white"/>
                        <text x="16" y="21" font-size="14" font-weight="bold" text-anchor="middle" fill="${isPast ? '#10B981' : isActive ? '#EF4444' : '#6B7280'}">
                          ${isPickup ? 'P' : 'D'}
                        </text>
                      </svg>
                    `),
                    scaledSize: new window.google.maps.Size(32, 40),
                    anchor: new window.google.maps.Point(16, 40)
                  }}
                  zIndex={isActive ? 100 : idx}
                >
                  {selectedMarker === idx && (
                    <InfoWindow onCloseClick={() => setSelectedMarker(null)}>
                      <div className="p-2 max-w-xs">
                        <div className="flex items-start gap-2 mb-2">
                          <span className="text-xl">{getStepIcon(step)}</span>
                          <div>
                            <p className="text-sm font-bold text-gray-900 mb-1">
                              {step.employee?.user?.name || step.label || 'Stop'}
                            </p>
                            <p className="text-xs text-gray-600 leading-tight">
                              {step.location?.address}
                            </p>
                          </div>
                        </div>
                        {step.employee?.user?.phone && (
                          <button
                            onClick={handleCallEmployee}
                            className="w-full text-xs py-1 px-2 bg-blue-600 text-white rounded-md flex items-center justify-center gap-1"
                          >
                            <Phone className="w-3 h-3" />
                            Call
                          </button>
                        )}
                      </div>
                    </InfoWindow>
                  )}
                </Marker>
              );
            })}
          </GoogleMap>
        </div>

        {/* Compact navigation banner */}
        {trip && nextStep && isNavigationMode && nextStopInstructions && (
          <div className="absolute top-2 left-2 right-2 z-10">
            <div className="bg-white rounded-xl shadow-lg p-3 border border-gray-200">
              <div className="flex items-center gap-3">
                <div className="w-10 h-10 rounded-lg bg-blue-100 flex items-center justify-center flex-shrink-0">
                  <ManeuverIcon className="w-5 h-5 text-blue-600" />
                </div>
                <div className="flex-1 min-w-0">
                  <p className="text-base font-bold text-gray-900">{distanceToNextTurn}</p>
                  <p 
                    className="text-xs text-gray-600 line-clamp-1"
                    dangerouslySetInnerHTML={{ __html: nextStopInstructions }} 
                  />
                </div>
              </div>
            </div>
          </div>
        )}

        {/* Compact floating buttons */}
        <div className="absolute right-2 flex flex-col gap-2 z-10" style={{ bottom: `${sheetHeight + 16}px` }}>
          <button
            onClick={handleRecenter}
            className={`w-11 h-11 rounded-full shadow-md flex items-center justify-center transition-all ${
              isNavigationMode ? 'bg-blue-600' : 'bg-white'
            }`}
          >
            <Locate className={`w-5 h-5 ${isNavigationMode ? 'text-white' : 'text-gray-700'}`} />
          </button>
          <button
            onClick={handleCallEmployee}
            disabled={!nextStep?.employee}
            className="w-11 h-11 rounded-full bg-white shadow-md flex items-center justify-center disabled:opacity-50"
          >
            <Phone className="w-5 h-5 text-gray-700" />
          </button>
          <button
            onClick={() => setShowRouteInfo(!showRouteInfo)}
            className="w-11 h-11 rounded-full bg-white shadow-md flex items-center justify-center"
          >
            <Info className="w-5 h-5 text-gray-700" />
          </button>
          <button
            onClick={handleEmergency}
            className="w-11 h-11 rounded-full bg-red-600 shadow-md flex items-center justify-center"
          >
            <AlertCircle className="w-5 h-5 text-white" />
          </button>
        </div>

        {/* Compact route info panel */}
        {showRouteInfo && trip && (
          <div className="absolute top-16 right-2 w-56 bg-white rounded-xl shadow-lg p-3 z-10 text-xs">
            <div className="flex items-center justify-between mb-2">
              <h3 className="text-sm font-bold text-gray-900">Route</h3>
              <button onClick={() => setShowRouteInfo(false)}>
                <X className="w-4 h-4 text-gray-400" />
              </button>
            </div>
            <div className="space-y-1.5">
              <div className="flex justify-between py-1 border-b border-gray-100">
                <span className="text-gray-600">Distance:</span>
                <span className="font-semibold">{totalTripDistance.toFixed(1)} km</span>
              </div>
              <div className="flex justify-between py-1 border-b border-gray-100">
                <span className="text-gray-600">Completed:</span>
                <span className="font-semibold text-green-600">{completedDistance.toFixed(1)} km</span>
              </div>
              <div className="flex justify-between py-1 border-b border-gray-100">
                <span className="text-gray-600">Remaining:</span>
                <span className="font-semibold text-blue-600">{remainingStops}</span>
              </div>
              <div className="flex justify-between py-1 border-b border-gray-100">
                <span className="text-gray-600">Speed:</span>
                <span className="font-semibold">{currentSpeed} km/h</span>
              </div>
              <div className="flex justify-between py-1">
                <span className="text-gray-600">ETA:</span>
                <span className="font-semibold">{estimatedArrival}</span>
              </div>
            </div>
          </div>
        )}

        {/* Compact bottom sheet */}
        <div 
          ref={sheetRef}
          className="absolute inset-x-0 bottom-0 z-20"
          style={{ 
            height: `${sheetHeight}px`,
            transition: isDragging ? 'none' : 'height 0.2s ease-out'
          }}
        >
          <div className="h-full mx-2 mb-2 rounded-t-2xl bg-white shadow-xl overflow-hidden flex flex-col">
            {/* Drag handle */}
            <div
              className="pt-2 pb-1 flex justify-center cursor-grab active:cursor-grabbing"
              onTouchStart={handleTouchStart}
              onTouchMove={handleTouchMove}
              onTouchEnd={handleTouchEnd}
              onClick={() => {
                if (sheetHeight === SHEET_HEIGHTS.MIN) {
                  setSheetHeight(SHEET_HEIGHTS.MIDDLE);
                } else if (sheetHeight === SHEET_HEIGHTS.MIDDLE) {
                  setSheetHeight(SHEET_HEIGHTS.MAX);
                } else {
                  setSheetHeight(SHEET_HEIGHTS.MIN);
                }
              }}
            >
              <div className="w-10 h-1 rounded-full bg-gray-300" />
            </div>

            <div className="flex-1 overflow-y-auto">
              {trip && nextStep ? (
                <div className="px-3 pb-3 space-y-2">
                  {/* Compact ETA bar */}
                  <div className="flex items-center justify-between py-2 px-3 rounded-lg bg-blue-50 text-xs">
                    <div className="flex items-center gap-2">
                      <Clock className="w-4 h-4 text-blue-600" />
                      <span className="font-bold text-gray-900">{estimatedArrival || eta}</span>
                    </div>
                    <div className="font-bold text-gray-900">{distance}</div>
                    <div className="px-2 py-0.5 rounded-md text-xs font-semibold bg-white border border-gray-200">
                      {trafficCondition}
                    </div>
                  </div>

                  {/* Next stop */}
                  <div className="flex items-center gap-3 py-2 px-3 rounded-lg bg-gray-50 border border-gray-200">
                    <div className="w-9 h-9 rounded-lg bg-blue-600 flex items-center justify-center flex-shrink-0 text-sm font-bold text-white">
                      {currentStepIndex + 1}
                    </div>
                    <div className="flex-1 min-w-0">
                      <p className="text-xs font-semibold text-gray-500 mb-0.5">
                        {nextStep.type === 'pickup' || nextStep.type === 'office_pickup' ? 'PICKUP' : 'DROP'}
                      </p>
                      <p className="text-sm font-bold text-gray-900 truncate">
                        {nextStep.employee?.user?.name || nextStep.label}
                      </p>
                      <p className="text-xs text-gray-600 truncate">{nextStep.location?.address}</p>
                    </div>
                    {nextStep.employee?.user?.phone && (
                      <button
                        onClick={handleCallEmployee}
                        className="p-2 rounded-lg bg-green-50 text-green-700"
                      >
                        <Phone className="w-4 h-4" />
                      </button>
                    )}
                  </div>

                  {/* Action button */}
                  <button
                    onClick={markCurrentStepCompleted}
                    className="w-full flex items-center justify-center gap-2 py-2.5 rounded-lg bg-green-600 text-white text-sm font-bold shadow-md"
                  >
                    <Check className="w-4 h-4" />
                    {nextStep.type === 'pickup' || nextStep.type === 'office_pickup' ? 'Confirm Pickup' : 'Confirm Drop'}
                  </button>

                  {/* Upcoming stops */}
                  {sheetHeight >= SHEET_HEIGHTS.MIDDLE && remainingStops > 0 && (
                    <div className="pt-2 border-t border-gray-200">
                      <p className="text-xs font-semibold text-gray-500 mb-2 flex items-center justify-between">
                        <span>Upcoming ({remainingStops})</span>
                        <button
                          onClick={() => setSheetHeight(sheetHeight === SHEET_HEIGHTS.MAX ? SHEET_HEIGHTS.MIDDLE : SHEET_HEIGHTS.MAX)}
                          className="text-blue-600"
                        >
                          {sheetHeight === SHEET_HEIGHTS.MAX ? <ChevronDown className="w-4 h-4" /> : <ChevronUp className="w-4 h-4" />}
                        </button>
                      </p>
                      <div className="space-y-2 max-h-48 overflow-y-auto">
                        {routeSteps.slice(currentStepIndex + 1).map((step, idx) => (
                          <div
                            key={idx}
                            className="flex items-center gap-2 py-2 px-2 rounded-lg bg-gray-50 text-xs"
                          >
                            <span className="text-base">{getStepIcon(step)}</span>
                            <div className="flex-1 min-w-0">
                              <p className="text-xs font-semibold text-gray-900 truncate">
                                {step.employee?.user?.name || step.label}
                              </p>
                              <p className="text-xs text-gray-600 truncate">
                                {step.location?.address}
                              </p>
                            </div>
                            <span className="text-xs font-semibold text-gray-400">
                              #{currentStepIndex + idx + 2}
                            </span>
                          </div>
                        ))}
                      </div>
                    </div>
                  )}
                </div>
              ) : (
                <div className="p-6 text-center">
                  <div className="w-14 h-14 mx-auto mb-3 rounded-full bg-gray-100 flex items-center justify-center">
                    <Navigation className="w-7 h-7 text-gray-400" />
                  </div>
                  <p className="text-sm font-bold text-gray-900 mb-1">No active trip</p>
                  <p className="text-xs text-gray-500">Waiting for assignment</p>
                </div>
              )}
            </div>
          </div>
        </div>
      </div>
    </DriverLayout>
  );
};

export default DriverMap;