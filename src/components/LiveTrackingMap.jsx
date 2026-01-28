// src/components/LiveTrackingMap.jsx
import React, { useState, useEffect, useRef, useCallback } from 'react';
import { GoogleMap, Marker, DirectionsRenderer, Polyline, InfoWindow, Circle } from '@react-google-maps/api';
import { X, Navigation, Phone, MapPin, Clock, User, Home, Building2 } from 'lucide-react';

const mapContainerStyle = {
  width: '100%',
  height: '100%'
};

const mapStyles = [
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
  }
];

const LiveTrackingMap = ({ trip, currentLocation, locationHistory = [], onClose }) => {
  const [map, setMap] = useState(null);
  const [directionsResponse, setDirectionsResponse] = useState(null);
  const [selectedMarker, setSelectedMarker] = useState(null);
  const [bearing, setBearing] = useState(0);
  const mapRef = useRef(null);

  // Calculate bearing from location history
  useEffect(() => {
    if (locationHistory.length >= 2) {
      const recent = locationHistory[0].location.coordinates;
      const prev = locationHistory[1].location.coordinates;
      
      const startLat = (prev.lat * Math.PI) / 180;
      const startLng = (prev.lng * Math.PI) / 180;
      const endLat = (recent.lat * Math.PI) / 180;
      const endLng = (recent.lng * Math.PI) / 180;

      const dLng = endLng - startLng;
      const y = Math.sin(dLng) * Math.cos(endLat);
      const x = Math.cos(startLat) * Math.sin(endLat) - Math.sin(startLat) * Math.cos(endLat) * Math.cos(dLng);
      const bearingCalc = (Math.atan2(y, x) * 180) / Math.PI;

      setBearing((bearingCalc + 360) % 360);
    }
  }, [locationHistory]);

  // Calculate route
  useEffect(() => {
    if (!currentLocation || !trip || !window.google || !trip.employees?.length) return;

    const directionsService = new window.google.maps.DirectionsService();
    const currentPos = currentLocation.location?.coordinates || currentLocation;

    // Get pending pickups and drops
    const pendingStops = [];
    
    if (trip.tripType === 'login') {
      trip.employees.forEach(emp => {
        if (emp.status !== 'picked_up' && emp.status !== 'dropped' && emp.pickupLocation?.coordinates) {
          pendingStops.push({
            location: emp.pickupLocation.coordinates,
            type: 'pickup',
            employee: emp
          });
        }
      });
      if (trip.officeLocation?.coordinates) {
        pendingStops.push({
          location: trip.officeLocation.coordinates,
          type: 'office',
          label: 'Office'
        });
      }
    } else {
      if (trip.officeLocation?.coordinates) {
        pendingStops.push({
          location: trip.officeLocation.coordinates,
          type: 'office',
          label: 'Office'
        });
      }
      trip.employees.forEach(emp => {
        if (emp.status !== 'dropped' && emp.dropLocation?.coordinates) {
          pendingStops.push({
            location: emp.dropLocation.coordinates,
            type: 'drop',
            employee: emp
          });
        }
      });
    }

    if (pendingStops.length === 0) return;

    const destination = pendingStops[pendingStops.length - 1].location;
    const waypoints = pendingStops.slice(0, -1).map(stop => ({
      location: stop.location,
      stopover: true
    }));

    const request = {
      origin: currentPos,
      destination: destination,
      waypoints: waypoints.length > 0 ? waypoints : undefined,
      travelMode: window.google.maps.TravelMode.DRIVING,
      drivingOptions: {
        departureTime: new Date(),
        trafficModel: 'bestguess'
      }
    };

    directionsService.route(request, (result, status) => {
      if (status === 'OK') {
        setDirectionsResponse(result);
      }
    });
  }, [currentLocation, trip]);

  const onMapLoad = useCallback((mapInstance) => {
    setMap(mapInstance);
    mapRef.current = mapInstance;
  }, []);

  // Get all stops for markers
  const getAllStops = () => {
    if (!trip) return [];
    const stops = [];

    if (trip.tripType === 'login') {
      trip.employees?.forEach((emp, idx) => {
        if (emp.pickupLocation?.coordinates) {
          stops.push({
            position: emp.pickupLocation.coordinates,
            type: 'pickup',
            employee: emp,
            label: `P${idx + 1}`,
            completed: emp.status === 'picked_up' || emp.status === 'dropped'
          });
        }
      });
      if (trip.officeLocation?.coordinates) {
        stops.push({
          position: trip.officeLocation.coordinates,
          type: 'office',
          label: 'Office',
          completed: false
        });
      }
    } else {
      if (trip.officeLocation?.coordinates) {
        stops.push({
          position: trip.officeLocation.coordinates,
          type: 'office',
          label: 'Office',
          completed: false
        });
      }
      trip.employees?.forEach((emp, idx) => {
        if (emp.dropLocation?.coordinates) {
          stops.push({
            position: emp.dropLocation.coordinates,
            type: 'drop',
            employee: emp,
            label: `D${idx + 1}`,
            completed: emp.status === 'dropped'
          });
        }
      });
    }

    return stops;
  };

  const stops = getAllStops();
  const center = currentLocation?.location?.coordinates || currentLocation || { lat: 12.9716, lng: 77.5946 };

  return (
    <div className="relative w-full h-full">
      <GoogleMap
        mapContainerStyle={mapContainerStyle}
        center={center}
        zoom={14}
        onLoad={onMapLoad}
        options={{
          disableDefaultUI: true,
          zoomControl: true,
          styles: mapStyles,
          gestureHandling: 'greedy'
        }}
      >
        {/* Route */}
        {directionsResponse && (
          <DirectionsRenderer
            directions={directionsResponse}
            options={{
              suppressMarkers: true,
              polylineOptions: {
                strokeColor: '#5B8DEF',
                strokeWeight: 5,
                strokeOpacity: 0.8
              }
            }}
          />
        )}

        {/* Location trail */}
        {locationHistory.length > 1 && (
          <Polyline
            path={locationHistory.map(loc => loc.location.coordinates)}
            options={{
              strokeColor: '#93C5FD',
              strokeWeight: 4,
              strokeOpacity: 0.5,
              geodesic: true
            }}
          />
        )}

        {/* Current location - circular car marker */}
        {currentLocation && (
          <>
            <Circle
              center={center}
              radius={(currentLocation.location?.accuracy || 20)}
              options={{
                fillColor: '#4F46E5',
                fillOpacity: 0.1,
                strokeColor: '#4F46E5',
                strokeOpacity: 0.3,
                strokeWeight: 1
              }}
            />
            
            <Marker
              position={center}
              icon={{
                url: 'data:image/svg+xml;charset=UTF-8,' + encodeURIComponent(`
                  <svg width="48" height="48" viewBox="0 0 48 48" xmlns="http://www.w3.org/2000/svg">
                    <defs>
                      <filter id="shadow" x="-50%" y="-50%" width="200%" height="200%">
                        <feDropShadow dx="0" dy="2" stdDeviation="2" flood-opacity="0.3"/>
                      </filter>
                    </defs>
                    <circle cx="24" cy="24" r="20" fill="white" filter="url(#shadow)"/>
                    <circle cx="24" cy="24" r="18" fill="#10B981"/>
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

        {/* Stop markers */}
        {stops.map((stop, idx) => (
          <Marker
            key={idx}
            position={stop.position}
            onClick={() => setSelectedMarker(idx)}
            icon={{
              url: 'data:image/svg+xml;charset=UTF-8,' + encodeURIComponent(`
                <svg width="32" height="40" viewBox="0 0 32 40" xmlns="http://www.w3.org/2000/svg">
                  <path d="M16 0C7.2 0 0 7.2 0 16c0 12 16 24 16 24s16-12 16-24c0-8.8-7.2-16-16-16z" 
                    fill="${stop.completed ? '#10B981' : '#EF4444'}"/>
                  <circle cx="16" cy="16" r="10" fill="white"/>
                  <text x="16" y="21" font-size="12" font-weight="bold" text-anchor="middle" fill="${stop.completed ? '#10B981' : '#EF4444'}">
                    ${stop.type === 'pickup' ? 'P' : stop.type === 'drop' ? 'D' : 'O'}
                  </text>
                </svg>
              `),
              scaledSize: new window.google.maps.Size(32, 40),
              anchor: new window.google.maps.Point(16, 40)
            }}
            zIndex={stop.completed ? 50 : 100}
          >
            {selectedMarker === idx && (
              <InfoWindow onCloseClick={() => setSelectedMarker(null)}>
                <div className="p-2 max-w-xs">
                  <div className="flex items-start gap-2 mb-2">
                    <span className="text-base">
                      {stop.type === 'pickup' ? '📍' : stop.type === 'drop' ? '🏠' : '🏢'}
                    </span>
                    <div>
                      <p className="text-xs font-bold text-gray-900 mb-1">
                        {stop.employee?.employee?.user?.name || stop.label || 'Stop'}
                      </p>
                      <p className="text-xs text-gray-600 leading-tight">
                        {stop.type === 'pickup' 
                          ? stop.employee?.pickupLocation?.address 
                          : stop.type === 'drop' 
                          ? stop.employee?.dropLocation?.address 
                          : trip?.officeLocation?.address}
                      </p>
                      {stop.employee && (
                        <div className="mt-2">
                          <span className={`text-xs px-2 py-1 rounded-full ${
                            stop.completed 
                              ? 'bg-green-100 text-green-800' 
                              : 'bg-red-100 text-red-800'
                          }`}>
                            {stop.employee.status?.replace('_', ' ').toUpperCase() || 'PENDING'}
                          </span>
                        </div>
                      )}
                    </div>
                  </div>
                  {stop.employee?.employee?.user?.phone && (
                    <button
                      onClick={() => window.location.href = `tel:${stop.employee.employee.user.phone}`}
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
        ))}
      </GoogleMap>

      {/* Close button */}
      {onClose && (
        <button
          onClick={onClose}
          className="absolute top-3 right-3 w-10 h-10 bg-white rounded-full shadow-lg flex items-center justify-center hover:bg-gray-50 z-10"
        >
          <X className="w-5 h-5 text-gray-700" />
        </button>
      )}

      {/* Compact info overlay */}
      <div className="absolute bottom-3 left-3 right-3 bg-white rounded-xl shadow-xl p-3 z-10">
        <div className="flex items-center justify-between mb-2">
          <div>
            <p className="text-xs font-bold text-gray-900">{trip?.tripName}</p>
            <p className="text-xs text-gray-600">{trip?.routeName}</p>
          </div>
          <div className="flex items-center gap-2">
            <div className="w-2 h-2 rounded-full bg-green-500 animate-pulse" />
            <span className="text-xs font-semibold text-green-600">LIVE</span>
          </div>
        </div>
        
        <div className="grid grid-cols-3 gap-2 text-xs">
          <div className="text-center py-1 bg-gray-50 rounded-lg">
            <p className="font-bold text-gray-900">{trip?.employees?.length || 0}</p>
            <p className="text-gray-600">Total</p>
          </div>
          <div className="text-center py-1 bg-blue-50 rounded-lg">
            <p className="font-bold text-blue-900">
              {trip?.employees?.filter(e => e.status === 'picked_up').length || 0}
            </p>
            <p className="text-blue-600">Picked</p>
          </div>
          <div className="text-center py-1 bg-green-50 rounded-lg">
            <p className="font-bold text-green-900">
              {trip?.employees?.filter(e => e.status === 'dropped').length || 0}
            </p>
            <p className="text-green-600">Dropped</p>
          </div>
        </div>

        {currentLocation && (
          <div className="mt-2 pt-2 border-t border-gray-200 flex items-center justify-between text-xs">
            <span className="text-gray-600">Speed:</span>
            <span className="font-semibold text-gray-900">
              {Math.round((currentLocation.location?.speed || currentLocation.speed || 0) * 3.6)} km/h
            </span>
            <span className="text-gray-600">•</span>
            <span className="text-gray-600">
              {new Date(currentLocation.timestamp).toLocaleTimeString('en-US', {
                hour: '2-digit',
                minute: '2-digit'
              })}
            </span>
          </div>
        )}
      </div>
    </div>
  );
};

export default LiveTrackingMap;