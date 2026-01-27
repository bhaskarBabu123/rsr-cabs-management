// src/pages/driver/DriverMap.jsx
import React, { useState, useEffect, useRef, useCallback } from 'react';
import {
  Navigation,
  MapPin,
  Clock,
  Phone,
  AlertCircle,
  Check,
  ArrowLeft,
  User,
  Home,
  Building2,
  Locate,
  TrendingUp,
  ExternalLink,
  MessageCircle,
  ChevronDown,
  ChevronUp,
  Route,
  Info,
  X
} from 'lucide-react';
import DriverLayout from '../../components/layouts/DriverLayout';
import LoadingSpinner from '../../components/LoadingSpinner';
import { useLocation } from '../../context/LocationContext';
import { useSocket } from '../../context/SocketContext';
import { tripAPI, locationAPI, driverAPI } from '../../services/api';
import { GoogleMap, Marker, DirectionsRenderer, Polyline, InfoWindow } from '@react-google-maps/api';
import toast from 'react-hot-toast';

const mapContainerStyle = {
  width: '100%',
  height: '100%'
};

const customMapStyles = [
  {
    featureType: 'poi',
    elementType: 'labels',
    stylers: [{ visibility: 'on' }]
  },
  {
    featureType: 'transit',
    elementType: 'labels',
    stylers: [{ visibility: 'on' }]
  },
  {
    featureType: 'road',
    elementType: 'geometry.fill',
    stylers: [{ color: '#ffffff' }]
  },
  {
    featureType: 'road',
    elementType: 'geometry.stroke',
    stylers: [{ color: '#d0d0d0' }]
  }
];

// Swipeable bottom sheet heights
const SHEET_HEIGHTS = {
  MIN: 160,
  MIDDLE: 400,
  MAX: window.innerHeight * 0.75
};

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
    const R = 6371; // Earth's radius in km
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
        // Send via socket for real-time updates
        if (socket) {
          sendLocationUpdate(trip._id, locationData.location);
        }
        
        // Also send via HTTP API as backup
        await locationAPI.updateLocation(locationData);
        
        // Update location history for trail effect
        setLocationHistory(prev => {
          const updated = [...prev, currentLocation];
          return updated.slice(-50); // Keep last 50 points
        });

        // Calculate speed, bearing, and distance traveled
        if (previousLocation.current) {
          const newBearing = calculateBearing(previousLocation.current, currentLocation);
          setBearing(newBearing);
          
          if (currentLocation.speed !== undefined) {
            setCurrentSpeed(Math.round(currentLocation.speed * 3.6)); // Convert m/s to km/h
          }

          // Calculate distance traveled
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

    // Send immediately
    sendLocation();

    // Then send every 5 seconds
    locationUpdateInterval.current = setInterval(sendLocation, 5000);

    return () => {
      if (locationUpdateInterval.current) {
        clearInterval(locationUpdateInterval.current);
      }
    };
  }, [currentLocation, trip, socket, sendLocationUpdate, bearing]);

  // Calculate route & ETA
  const calculateRoute = useCallback(() => {
    if (!currentLocation || routeSteps.length === 0 || !window.google) return;

    const directionsService = new window.google.maps.DirectionsService();
    const nextStop = routeSteps[currentStepIndex];
    if (!nextStop?.location?.coordinates) return;

    const waypoints = [];
    
    // Add remaining stops as waypoints for better route calculation
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
      }
    };

    directionsService.route(request, (result, status) => {
      if (status === 'OK') {
        setDirectionsResponse(result);
        const leg = result.routes[0].legs[0];
        setDistance(leg.distance.text);
        setEta(leg.duration.text);
        
        // Calculate total trip distance
        let totalDist = 0;
        result.routes[0].legs.forEach(l => {
          totalDist += l.distance.value / 1000; // Convert to km
        });
        setTotalTripDistance(totalDist);
        
        // Calculate estimated arrival time
        const etaMinutes = Math.round(leg.duration.value / 60);
        const arrivalTime = new Date(Date.now() + etaMinutes * 60000);
        setEstimatedArrival(arrivalTime.toLocaleTimeString('en-US', { 
          hour: 'numeric', 
          minute: '2-digit',
          hour12: true 
        }));

        // Detect traffic condition based on duration in traffic
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

        // Get next turn instruction
        if (leg.steps && leg.steps.length > 0) {
          const nextStep = leg.steps[0];
          setNextStopInstructions(nextStep.instructions);
        }

        // Smooth camera movement
        if (mapRef.current) {
          const bounds = new window.google.maps.LatLngBounds();
          bounds.extend(currentLocation);
          bounds.extend(nextStop.location.coordinates);
          mapRef.current.fitBounds(bounds, { top: 100, right: 50, bottom: sheetHeight + 50, left: 50 });
        }
      } else {
        console.error('Directions request failed:', status);
      }
    });
  }, [currentLocation, routeSteps, currentStepIndex, sheetHeight]);

  // Auto-recalculate route every 30 seconds
  useEffect(() => {
    if (trip && routeSteps.length > 0) {
      calculateRoute();
      
      routeRecalculationInterval.current = setInterval(() => {
        calculateRoute();
      }, 30000); // Every 30 seconds

      return () => {
        if (routeRecalculationInterval.current) {
          clearInterval(routeRecalculationInterval.current);
        }
      };
    }
  }, [trip, routeSteps, calculateRoute]);

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
        // Recalculate route for next stop
        setTimeout(() => calculateRoute(), 500);
      } else {
        // Trip completed
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

    // Constrain height
    newHeight = Math.max(SHEET_HEIGHTS.MIN, Math.min(SHEET_HEIGHTS.MAX, newHeight));
    setSheetHeight(newHeight);
  };

  const handleTouchEnd = () => {
    setIsDragging(false);
    
    // Snap to nearest height
    if (sheetHeight < SHEET_HEIGHTS.MIN + 50) {
      setSheetHeight(SHEET_HEIGHTS.MIN);
    } else if (sheetHeight < SHEET_HEIGHTS.MIDDLE + 100) {
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
      mapRef.current.panTo({ lat: currentLocation.lat, lng: currentLocation.lng });
      mapRef.current.setZoom(17);
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

  const handleNavigateToLocation = (location) => {
    if (!location?.coordinates) {
      toast.error('Location coordinates not available');
      return;
    }

    const { lat, lng } = location.coordinates;
    
    // Open in Google Maps app or browser
    const isIOS = /iPad|iPhone|iPod/.test(navigator.userAgent);
    const isAndroid = /Android/.test(navigator.userAgent);

    let url;
    if (isIOS) {
      url = `maps://maps.google.com/maps?daddr=${lat},${lng}&amp;ll=`;
    } else if (isAndroid) {
      url = `google.navigation:q=${lat},${lng}`;
    } else {
      url = `https://www.google.com/maps/dir/?api=1&destination=${lat},${lng}`;
    }

    window.open(url, '_blank');
  };

  const handleEmergency = () => {
    if (socket && trip && currentLocation) {
      const message = 'Emergency alert from driver!';
      sendLocationUpdate(trip._id, {
        coordinates: currentLocation,
        emergency: true,
        timestamp: new Date().toISOString()
      });
      toast.error('Emergency alert sent to all!', { icon: '🚨', duration: 3000 });
    }
  };

  const getStepIcon = (step) => {
    if (step.type === 'pickup') return User;
    if (step.type === 'drop') return Home;
    if (step.type === 'office_drop' || step.type === 'office_pickup') return Building2;
    return MapPin;
  };

  const getTrafficColor = () => {
    switch (trafficCondition) {
      case 'heavy': return 'text-red-600 bg-red-50';
      case 'moderate': return 'text-amber-600 bg-amber-50';
      case 'light': return 'text-green-600 bg-green-50';
      default: return 'text-gray-600 bg-gray-50';
    }
  };

  const nextStep = routeSteps[currentStepIndex];
  const center = currentLocation || { lat: 13.0405451, lng: 77.5897363 };
  const progressPercentage = routeSteps.length > 0 
    ? ((routeSteps.filter(s => s.completed).length / routeSteps.length) * 100).toFixed(0)
    : 0;

  if (isLoading) {
    return (
      <DriverLayout>
        <div className="flex flex-col justify-center items-center h-[80vh] gap-4">
          <LoadingSpinner size="lg" />
          <p className="text-sm text-gray-500">Loading your trip...</p>
        </div>
      </DriverLayout>
    );
  }

  return (
    <DriverLayout>
      <div className="h-[calc(100vh-64px)] w-full relative bg-gray-900">
        {/* Map Area */}
        <div className="absolute inset-0">
          <GoogleMap
            mapContainerStyle={mapContainerStyle}
            center={center}
            zoom={16}
            onLoad={onMapLoad}
            options={{
              disableDefaultUI: true,
              zoomControl: false,
              streetViewControl: false,
              mapTypeControl: false,
              fullscreenControl: false,
              styles: customMapStyles,
              gestureHandling: 'greedy'
            }}
          >
            {/* Route polyline */}
            {directionsResponse && (
              <DirectionsRenderer
                directions={directionsResponse}
                options={{
                  suppressMarkers: true,
                  polylineOptions: {
                    strokeColor: '#4F46E5',
                    strokeWeight: 6,
                    strokeOpacity: 0.9
                  }
                }}
              />
            )}

            {/* Location history trail */}
            {locationHistory.length > 1 && (
              <Polyline
                path={locationHistory}
                options={{
                  strokeColor: '#93C5FD',
                  strokeWeight: 4,
                  strokeOpacity: 0.7,
                  geodesic: true
                }}
              />
            )}

            {/* Current location marker - animated car */}
            {currentLocation && (
              <Marker
                position={currentLocation}
                icon={{
                  path: 'M17.402 0H5.643C2.526 0 0 3.467 0 6.584v34.804c0 3.116 2.526 5.644 5.643 5.644h11.759c3.116 0 5.644-2.527 5.644-5.644V6.584C23.044 3.467 20.518 0 17.402 0zM22.057 14.188v11.665l-2.729 2.729h-16.61l-2.729-2.729V14.188L22.057 14.188zM20.625 10.773c-1.016 3.9-2.219 8.51-2.219 8.51H4.638s-1.203-4.61-2.219-8.51C2.419 10.773 11.5 7.5 11.5 7.5S20.625 10.773 20.625 10.773z',
                  fillColor: '#4F46E5',
                  fillOpacity: 1,
                  strokeColor: '#FFFFFF',
                  strokeWeight: 2,
                  scale: 0.8,
                  anchor: new window.google.maps.Point(11.5, 23),
                  rotation: bearing
                }}
                zIndex={1000}
              />
            )}

            {/* Route stops markers */}
            {routeSteps.map((step, idx) => {
              const isActive = idx === currentStepIndex;
              
              return (
                <Marker
                  key={idx}
                  position={step.location.coordinates}
                  onClick={() => setSelectedMarker(idx)}
                  icon={{
                    path: window.google.maps.SymbolPath.CIRCLE,
                    fillColor: step.completed ? '#10B981' : isActive ? '#EF4444' : '#6B7280',
                    fillOpacity: 1,
                    strokeColor: '#FFFFFF',
                    strokeWeight: 3,
                    scale: isActive ? 14 : 11
                  }}
                  label={{
                    text: `${idx + 1}`,
                    color: '#FFFFFF',
                    fontSize: '14px',
                    fontWeight: 'bold'
                  }}
                  zIndex={isActive ? 100 : idx}
                >
                  {selectedMarker === idx && (
                    <InfoWindow onCloseClick={() => setSelectedMarker(null)}>
                      <div className="p-2">
                        <p className="font-semibold text-sm mb-1">
                          {step.employee?.user?.name || step.label || 'Stop'}
                        </p>
                        <p className="text-xs text-gray-600 mb-2">
                          {step.location?.address}
                        </p>
                        <button
                          onClick={() => handleNavigateToLocation(step.location)}
                          className="text-xs text-blue-600 font-medium flex items-center gap-1"
                        >
                          <ExternalLink className="w-3 h-3" />
                          Navigate here
                        </button>
                      </div>
                    </InfoWindow>
                  )}
                </Marker>
              );
            })}
          </GoogleMap>
        </div>

        {/* Top status bar */}
        <div className="absolute top-0 left-0 right-0 bg-gradient-to-b from-black/60 to-transparent pt-3 pb-6 px-3 z-10">
          <div className="flex items-center justify-between mb-3">
            <div className="flex items-center gap-2 px-4 py-2.5 rounded-full bg-white/95 backdrop-blur shadow-lg">
              <Navigation className="w-4 h-4 text-indigo-600" />
              <span className="text-sm font-semibold text-gray-900 truncate max-w-[150px]">
                {trip ? trip.tripName : 'No Active Trip'}
              </span>
            </div>

            <div className="flex items-center gap-2">
              {/* Speed indicator */}
              {currentSpeed > 0 && (
                <div className="px-3 py-2 rounded-full bg-white/95 backdrop-blur shadow-lg">
                  <div className="flex items-center gap-1.5">
                    <TrendingUp className="w-4 h-4 text-indigo-600" />
                    <span className="text-sm font-bold text-gray-900">{currentSpeed}</span>
                    <span className="text-xs text-gray-500">km/h</span>
                  </div>
                </div>
              )}

              {/* GPS status */}
              <div className="px-3 py-2 rounded-full bg-white/95 backdrop-blur shadow-lg">
                <div className="flex items-center gap-2">
                  <span className={`w-2 h-2 rounded-full ${isTracking ? 'bg-green-500 animate-pulse' : 'bg-red-500'}`} />
                  <span className="text-xs font-medium text-gray-900">
                    {isTracking ? 'GPS' : 'No GPS'}
                  </span>
                </div>
              </div>
            </div>
          </div>

          {/* Trip progress bar */}
          {trip && (
            <div className="px-4 py-2 rounded-2xl bg-white/95 backdrop-blur shadow-lg">
              <div className="flex items-center justify-between mb-1">
                <span className="text-xs font-medium text-gray-600">Trip Progress</span>
                <span className="text-xs font-bold text-indigo-600">{progressPercentage}%</span>
              </div>
              <div className="w-full h-2 bg-gray-200 rounded-full overflow-hidden">
                <div 
                  className="h-full bg-gradient-to-r from-indigo-600 to-blue-600 transition-all duration-500"
                  style={{ width: `${progressPercentage}%` }}
                />
              </div>
            </div>
          )}
        </div>

        {/* Floating action buttons */}
        <div className="absolute right-4 flex flex-col gap-3 z-10" style={{ bottom: `${sheetHeight + 20}px` }}>
          <button
            onClick={handleRecenter}
            className="w-12 h-12 rounded-full bg-white shadow-lg flex items-center justify-center hover:bg-gray-50 active:scale-95 transition-transform"
            aria-label="Recenter map"
          >
            <Locate className="w-5 h-5 text-gray-700" />
          </button>
          <button
            onClick={handleCallEmployee}
            disabled={!nextStep?.employee}
            className="w-12 h-12 rounded-full bg-white shadow-lg flex items-center justify-center hover:bg-gray-50 active:scale-95 transition-transform disabled:opacity-50 disabled:cursor-not-allowed"
            aria-label="Call passenger"
          >
            <Phone className="w-5 h-5 text-gray-700" />
          </button>
          <button
            onClick={() => setShowRouteInfo(!showRouteInfo)}
            className="w-12 h-12 rounded-full bg-white shadow-lg flex items-center justify-center hover:bg-gray-50 active:scale-95 transition-transform"
            aria-label="Route info"
          >
            <Info className="w-5 h-5 text-gray-700" />
          </button>
          <button
            onClick={handleEmergency}
            className="w-12 h-12 rounded-full bg-red-600 shadow-lg flex items-center justify-center hover:bg-red-700 active:scale-95 transition-transform"
            aria-label="Emergency"
          >
            <AlertCircle className="w-5 h-5 text-white" />
          </button>
        </div>

        {/* Route info panel */}
        {showRouteInfo && trip && (
          <div className="absolute top-32 right-4 w-64 bg-white rounded-2xl shadow-2xl p-4 z-10">
            <div className="flex items-center justify-between mb-3">
              <h3 className="font-semibold text-gray-900">Route Info</h3>
              <button onClick={() => setShowRouteInfo(false)}>
                <X className="w-4 h-4 text-gray-400" />
              </button>
            </div>
            <div className="space-y-2 text-sm">
              <div className="flex justify-between">
                <span className="text-gray-600">Total Distance:</span>
                <span className="font-semibold">{totalTripDistance.toFixed(2)} km</span>
              </div>
              <div className="flex justify-between">
                <span className="text-gray-600">Completed:</span>
                <span className="font-semibold">{completedDistance.toFixed(2)} km</span>
              </div>
              <div className="flex justify-between">
                <span className="text-gray-600">Stops Remaining:</span>
                <span className="font-semibold">{routeSteps.filter(s => !s.completed).length}</span>
              </div>
              <div className="flex justify-between">
                <span className="text-gray-600">Current Speed:</span>
                <span className="font-semibold">{currentSpeed} km/h</span>
              </div>
            </div>
          </div>
        )}

        {/* Swipeable Bottom Sheet */}
        <div 
          ref={sheetRef}
          className="absolute inset-x-0 bottom-0 z-20"
          style={{ 
            height: `${sheetHeight}px`,
            transition: isDragging ? 'none' : 'height 0.3s ease-out'
          }}
        >
          <div className="h-full mx-3 mb-3 rounded-t-3xl bg-white shadow-2xl overflow-hidden flex flex-col">
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
              <div className="w-12 h-1.5 rounded-full bg-gray-300" />
            </div>

            <div className="flex-1 overflow-y-auto">
              {trip && nextStep ? (
                <div className="px-4 pb-4 space-y-4">
                  {/* ETA banner */}
                  <div className="flex items-center justify-between py-3 px-4 rounded-2xl bg-gradient-to-r from-indigo-50 to-blue-50 border border-indigo-100">
                    <div className="flex items-center gap-3">
                      <div className="w-10 h-10 rounded-full bg-indigo-600 flex items-center justify-center">
                        <Clock className="w-5 h-5 text-white" />
                      </div>
                      <div>
                        <p className="text-xs text-gray-600">Arriving at</p>
                        <p className="text-lg font-bold text-gray-900">{estimatedArrival || eta}</p>
                      </div>
                    </div>
                    <div className="text-right">
                      <p className="text-xs text-gray-600">Distance</p>
                      <p className="text-base font-bold text-gray-900">{distance}</p>
                    </div>
                  </div>

                  {/* Next stop card */}
                  <div className="bg-white border border-gray-100 rounded-2xl p-4">
                    <div className="flex items-start gap-3">
                      <div className="w-12 h-12 rounded-2xl bg-gradient-to-br from-indigo-600 to-blue-600 flex items-center justify-center shadow-lg flex-shrink-0">
                        <span className="text-lg font-bold text-white">
                          {currentStepIndex + 1}
                        </span>
                      </div>
                      <div className="flex-1 min-w-0">
                        <p className="text-xs uppercase tracking-wide text-gray-500 font-medium mb-1">
                          {nextStep.type === 'pickup' || nextStep.type === 'office_pickup' ? 'Pickup' : 'Drop-off'}
                        </p>
                        <p className="text-lg font-bold text-gray-900 mb-1">
                          {nextStep.employee?.user?.name || nextStep.label || 'Office'}
                        </p>
                        <div className="flex items-start gap-1.5 mb-3">
                          <MapPin className="w-4 h-4 text-gray-400 mt-0.5 flex-shrink-0" />
                          <p className="text-sm text-gray-600 line-clamp-2">
                            {nextStep.location?.address}
                          </p>
                        </div>
                        {nextStep.employee?.user?.phone && (
                          <div className="flex items-center gap-2">
                            <button
                              onClick={handleCallEmployee}
                              className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-green-50 text-green-700 text-xs font-medium"
                            >
                              <Phone className="w-3.5 h-3.5" />
                              Call
                            </button>
                            <button
                              onClick={() => handleNavigateToLocation(nextStep.location)}
                              className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-blue-50 text-blue-700 text-xs font-medium"
                            >
                              <ExternalLink className="w-3.5 h-3.5" />
                              Navigate
                            </button>
                          </div>
                        )}
                      </div>
                    </div>
                  </div>

                  {/* Turn-by-turn instruction */}
                  {nextStopInstructions && (
                    <div className="px-4 py-3 rounded-2xl bg-blue-50 border border-blue-100">
                      <div className="flex items-start gap-3">
                        <Navigation className="w-5 h-5 text-blue-600 flex-shrink-0 mt-0.5" />
                        <div className="flex-1">
                          <p className="text-xs uppercase text-blue-600 font-medium mb-1">Next Turn</p>
                          <p 
                            className="text-sm text-gray-800 font-medium"
                            dangerouslySetInnerHTML={{ __html: nextStopInstructions }} 
                          />
                        </div>
                      </div>
                    </div>
                  )}

                  {/* Traffic condition */}
                  <div className={`flex items-center justify-between py-2 px-4 rounded-xl ${getTrafficColor()}`}>
                    <span className="text-xs font-medium">Traffic condition</span>
                    <span className="text-xs font-bold">
                      {trafficCondition.charAt(0).toUpperCase() + trafficCondition.slice(1)}
                    </span>
                  </div>

                  {/* Action button */}
                  <button
                    onClick={markCurrentStepCompleted}
                    className="w-full flex items-center justify-center gap-3 py-4 rounded-2xl bg-gradient-to-r from-green-600 to-emerald-600 text-white font-bold text-base shadow-lg hover:from-green-700 hover:to-emerald-700 active:scale-98 transition-all"
                  >
                    <Check className="w-5 h-5" />
                    <span>
                      {nextStep.type === 'pickup' || nextStep.type === 'office_pickup' 
                        ? 'Confirm Pickup' 
                        : 'Confirm Drop-off'}
                    </span>
                  </button>

                  {/* Upcoming stops */}
                  {sheetHeight >= SHEET_HEIGHTS.MIDDLE && routeSteps.length > 1 && (
                    <div className="pt-4 border-t border-gray-100">
                      <p className="text-xs uppercase tracking-wide text-gray-500 font-medium mb-3 flex items-center justify-between">
                        <span>Upcoming Stops ({routeSteps.length - currentStepIndex - 1})</span>
                        <button
                          onClick={() => setSheetHeight(sheetHeight === SHEET_HEIGHTS.MAX ? SHEET_HEIGHTS.MIDDLE : SHEET_HEIGHTS.MAX)}
                          className="text-indigo-600"
                        >
                          {sheetHeight === SHEET_HEIGHTS.MAX ? <ChevronDown className="w-4 h-4" /> : <ChevronUp className="w-4 h-4" />}
                        </button>
                      </p>
                      <div className="space-y-2 max-h-[300px] overflow-y-auto">
                        {routeSteps.slice(currentStepIndex + 1).map((step, idx) => {
                          const StepIcon = getStepIcon(step);
                          return (
                            <div
                              key={idx}
                              className="flex items-center gap-3 py-2 px-3 rounded-xl bg-gray-50 hover:bg-gray-100 transition-colors cursor-pointer"
                              onClick={() => handleNavigateToLocation(step.location)}
                            >
                              <div className="w-8 h-8 rounded-full bg-gray-200 flex items-center justify-center flex-shrink-0">
                                <StepIcon className="w-4 h-4 text-gray-600" />
                              </div>
                              <div className="flex-1 min-w-0">
                                <p className="text-sm font-medium text-gray-900 truncate">
                                  {step.employee?.user?.name || step.label || 'Stop'}
                                </p>
                                <p className="text-xs text-gray-500 truncate">
                                  {step.location?.address}
                                </p>
                              </div>
                              <div className="flex items-center gap-2">
                                <span className="text-xs text-gray-400">#{currentStepIndex + idx + 2}</span>
                                <ExternalLink className="w-3.5 h-3.5 text-gray-400" />
                              </div>
                            </div>
                          );
                        })}
                      </div>
                    </div>
                  )}
                </div>
              ) : (
                <div className="p-8 text-center">
                  <div className="w-16 h-16 mx-auto mb-4 rounded-full bg-gray-100 flex items-center justify-center">
                    <Navigation className="w-8 h-8 text-gray-400" />
                  </div>
                  <p className="text-lg font-bold text-gray-900 mb-1">No active trip</p>
                  <p className="text-sm text-gray-500">
                    Waiting for your next assignment
                  </p>
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