// src/pages/hr/LiveTracking.jsx
import React, { useState, useEffect, useCallback } from 'react';
import {
  MapPin, Clock, Users, Car, Phone, AlertCircle, ArrowLeft, Navigation,
  User, Home, Building2, TrendingUp, Radio
} from 'lucide-react';
import HRLayout from '../../components/layouts/HRLayout';
import LoadingSpinner from '../../components/LoadingSpinner';
import { dashboardAPI, locationAPI } from '../../services/api';
import { useSocket } from '../../context/SocketContext';
import toast from 'react-hot-toast';
import LiveTrackingMap from '../../components/LiveTrackingMap';

const LiveTracking = () => {
  const [liveTrips, setLiveTrips] = useState([]);
  const [selectedTrip, setSelectedTrip] = useState(null);
  const [isLoading, setIsLoading] = useState(true);
  const [locationHistory, setLocationHistory] = useState([]);
  const [addresses, setAddresses] = useState({});
  const [lastUpdate, setLastUpdate] = useState(null);
  const { socket, joinTripRoom, leaveTripRoom } = useSocket();
  const [isMobile, setIsMobile] = useState(false);
  const [viewMode, setViewMode] = useState('list');
  const [mapModal, setMapModal] = useState(false);

  const geocode = useCallback(
    async (lat, lng, key) => {
      if (addresses[key] && addresses[key].length > 20) return;

      const cacheKey = `addr_${lat.toFixed(6)}_${lng.toFixed(6)}`;
      const cached = sessionStorage.getItem(cacheKey);
      if (cached && cached.length > 20) {
        setAddresses((prev) => ({ ...prev, [key]: cached }));
        return;
      }

      try {
        if (window.google?.maps?.Geocoder) {
          const geocoder = new window.google.maps.Geocoder();
          const response = await new Promise((resolve, reject) => {
            geocoder.geocode(
              { location: { lat, lng }, region: 'IN', language: 'en' },
              (results, status) => {
                if (status === 'OK') resolve(results);
                else reject(status);
              }
            );
          });

          const bestAddress = response
            .map(r => r.formatted_address)
            .filter(a => a && !a.includes('+'))
            .sort((a, b) => b.length - a.length)[0];

          if (bestAddress) {
            setAddresses((prev) => ({ ...prev, [key]: bestAddress }));
            sessionStorage.setItem(cacheKey, bestAddress);
            return;
          }
        }
      } catch (err) {
        console.warn('Geocode failed:', err);
      }

      const fallback = `${lat.toFixed(4)}, ${lng.toFixed(4)}`;
      setAddresses((prev) => ({ ...prev, [key]: fallback }));
    },
    [addresses]
  );

  useEffect(() => {
    const handleResize = () => setIsMobile(window.innerWidth < 1024);
    handleResize();
    window.addEventListener('resize', handleResize);
    return () => window.removeEventListener('resize', handleResize);
  }, []);

  useEffect(() => {
    const load = async () => {
      try {
        const res = await dashboardAPI.getLiveTrips();
        const trips = res.data.liveTrips || [];
        setLiveTrips(trips);
        setLastUpdate(new Date());
        
        trips.forEach((trip) => {
          if (trip.latestLocation) {
            const { lat, lng } = trip.latestLocation.location.coordinates;
            geocode(lat, lng, `trip-${trip._id}`);
          }
        });
        
        if (trips.length > 0 && !selectedTrip) setSelectedTrip(trips[0]);
      } catch {
        toast.error('Failed to load live trips');
      } finally {
        setIsLoading(false);
      }
    };
    load();
  }, []); // eslint-disable-line

  useEffect(() => {
    if (!socket) return;

    const handleLocationUpdate = (data) => {
      setLastUpdate(new Date());
      if (!selectedTrip || data.tripId !== selectedTrip._id) return;
      
      setLocationHistory((prev) => [data, ...prev].slice(0, 50));
      const { lat, lng } = data.location.coordinates;
      geocode(lat, lng, `current-${selectedTrip._id}`);
    };

    const handleTripStatusChange = async () => {
      try {
        const res = await dashboardAPI.getLiveTrips();
        setLiveTrips(res.data.liveTrips || []);
        setLastUpdate(new Date());
      } catch (e) {
        console.error('Failed to refresh trips', e);
      }
    };

    socket.on('location-update', handleLocationUpdate);
    socket.on('trip-status-changed', handleTripStatusChange);

    return () => {
      socket.off('location-update', handleLocationUpdate);
      socket.off('trip-status-changed', handleTripStatusChange);
    };
  }, [socket, selectedTrip, geocode]);

  useEffect(() => {
    if (!selectedTrip) return;
    
    joinTripRoom(selectedTrip._id);

    const loadHistory = async () => {
      try {
        const res = await locationAPI.getHistory(selectedTrip._id, { limit: 50 });
        const locs = res.data.locations || [];
        setLocationHistory(locs);
        
        locs.forEach((loc, i) => {
          const { lat, lng } = loc.location.coordinates;
          geocode(lat, lng, `hist-${selectedTrip._id}-${i}`);
        });
      } catch (err) {
        console.error('Failed to load history', err);
      }
    };

    loadHistory();

    if (selectedTrip.latestLocation) {
      const { lat, lng } = selectedTrip.latestLocation.location.coordinates;
      geocode(lat, lng, `current-${selectedTrip._id}`);
    }

    return () => leaveTripRoom(selectedTrip._id);
  }, [selectedTrip, geocode, joinTripRoom, leaveTripRoom]);

  const formatTime = (ts) =>
    new Date(ts).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
  
  const getAddress = (key, coords) =>
    addresses[key] || (coords ? `${coords.lat.toFixed(4)}, ${coords.lng.toFixed(4)}` : 'Loading...');

  const totalActive = liveTrips.length;
  const totalEmployees = liveTrips.reduce((s, t) => s + (t.employees?.length || 0), 0);
  const effectiveView = isMobile ? viewMode : 'detail';

  const handleSelectTrip = (trip) => {
    setSelectedTrip(trip);
    if (isMobile) setViewMode('detail');
  };

  const getStatusBadge = (status) => {
    const styles = {
      not_started: 'bg-gray-100 text-gray-800 border-gray-200',
      picked_up: 'bg-blue-100 text-blue-800 border-blue-200',
      dropped: 'bg-green-100 text-green-800 border-green-200'
    };
    return (
      <span className={`px-2 py-0.5 rounded-full text-[10px] font-bold border ${styles[status] || styles.not_started}`}>
        {status?.replace('_', ' ').toUpperCase() || 'PENDING'}
      </span>
    );
  };

  const nextEmployee =
    selectedTrip?.employees?.find((e) => e.status !== 'dropped') || selectedTrip?.employees?.[0];

  if (isLoading) {
    return (
      <HRLayout>
        <div className="flex items-center justify-center h-screen">
          <LoadingSpinner size="lg" />
        </div>
      </HRLayout>
    );
  }

  return (
    <HRLayout>
      <div className="h-[calc(100vh-64px)] overflow-hidden flex bg-slate-50">
        {/* Desktop Sidebar */}
        {!isMobile && (
          <div className="w-80 bg-white border-r border-slate-200 flex flex-col overflow-hidden flex-shrink-0">
            <div className="p-3 border-b border-slate-200">
              <h2 className="text-sm font-bold text-slate-900">Live Trips</h2>
              <p className="text-xs text-slate-600">Select to view details</p>
            </div>
            
            <div className="flex-1 overflow-y-auto p-2">
              {liveTrips.length === 0 ? (
                <div className="p-4 text-center">
                  <Radio className="w-8 h-8 text-slate-400 mx-auto mb-2" />
                  <p className="text-xs text-slate-600">No live trips</p>
                </div>
              ) : (
                liveTrips.map((trip) => {
                  const isActive = selectedTrip?._id === trip._id;
                  return (
                    <button
                      key={trip._id}
                      onClick={() => handleSelectTrip(trip)}
                      className={`w-full text-left p-2 rounded-lg mb-2 transition-all text-xs ${
                        isActive
                          ? 'bg-emerald-50 border-2 border-emerald-400'
                          : 'bg-slate-50 hover:bg-slate-100 border border-slate-200'
                      }`}
                    >
                      <div className="flex items-start gap-2 mb-2">
                        <Navigation className={`w-4 h-4 mt-0.5 ${isActive ? 'text-emerald-600' : 'text-slate-600'}`} />
                        <div className="flex-1 min-w-0">
                          <p className="font-bold text-slate-900 truncate">{trip.tripName}</p>
                          <p className="text-xs text-slate-600 truncate">{trip.routeName}</p>
                        </div>
                      </div>
                      
                      <div className="flex items-center gap-2 text-xs text-slate-700">
                        <Car className="w-3 h-3" />
                        <span className="truncate">{trip.assignedVehicle?.vehicleNumber || 'N/A'}</span>
                        <span className="ml-auto px-2 py-0.5 bg-emerald-100 text-emerald-800 rounded-full text-[10px] font-bold">
                          LIVE
                        </span>
                      </div>
                    </button>
                  );
                })
              )}
            </div>
          </div>
        )}

        {/* Main Content */}
        <div className="flex-1 overflow-hidden flex flex-col">
          {/* Top Bar */}
          <div className="bg-white border-b border-slate-200 px-3 py-2 flex-shrink-0">
            <div className="flex items-center justify-between">
              {isMobile && effectiveView === 'detail' && (
                <button
                  onClick={() => setViewMode('list')}
                  className="p-1.5 rounded-lg hover:bg-slate-100"
                >
                  <ArrowLeft className="w-4 h-4" />
                </button>
              )}
              
              <div className="flex-1 min-w-0 px-2">
                <h1 className="text-sm font-bold text-slate-900 truncate">Live Tracking</h1>
                <p className="text-xs text-slate-600">
                  {totalActive} trips • {totalEmployees} employees
                </p>
              </div>

              <div className="flex items-center gap-2 text-xs">
                <div className="w-2 h-2 rounded-full bg-green-500 animate-pulse" />
                <span className="font-semibold text-green-600">
                  {lastUpdate ? formatTime(lastUpdate) : '--'}
                </span>
              </div>
            </div>
          </div>

          {/* Mobile List View */}
          {isMobile && effectiveView === 'list' && (
            <div className="flex-1 overflow-y-auto p-3">
              {liveTrips.length === 0 ? (
                <div className="p-6 text-center">
                  <Radio className="w-12 h-12 text-slate-400 mx-auto mb-3" />
                  <p className="text-sm text-slate-600">No live trips running</p>
                </div>
              ) : (
                <div className="space-y-2">
                  {liveTrips.map((trip) => (
                    <button
                      key={trip._id}
                      onClick={() => handleSelectTrip(trip)}
                      className="w-full text-left bg-white border border-slate-200 rounded-xl p-3 hover:border-slate-300"
                    >
                      <div className="flex items-start gap-3 mb-2">
                        <div className="w-10 h-10 bg-emerald-100 rounded-lg flex items-center justify-center flex-shrink-0">
                          <Navigation className="w-5 h-5 text-emerald-600" />
                        </div>
                        <div className="flex-1 min-w-0">
                          <p className="text-sm font-bold text-slate-900 truncate">{trip.tripName}</p>
                          <p className="text-xs text-slate-600 truncate">{trip.routeName}</p>
                        </div>
                        <span className="px-2 py-1 bg-emerald-100 text-emerald-800 rounded-full text-[10px] font-bold">
                          LIVE
                        </span>
                      </div>
                      
                      <div className="grid grid-cols-2 gap-2 text-xs">
                        <div className="flex items-center gap-1">
                          <Car className="w-3 h-3 text-slate-600" />
                          <span className="truncate">{trip.assignedVehicle?.vehicleNumber}</span>
                        </div>
                        <div className="flex items-center gap-1">
                          <Users className="w-3 h-3 text-slate-600" />
                          <span>{trip.employees?.length || 0}</span>
                        </div>
                      </div>
                    </button>
                  ))}
                </div>
              )}
            </div>
          )}

          {/* Detail View */}
          {(effectiveView === 'detail' && selectedTrip) && (
            <div className="flex-1 overflow-y-auto p-3 space-y-2">
              {/* Trip Header */}
              <div className="bg-white border border-slate-200 rounded-xl p-3">
                <div className="flex items-start justify-between mb-2">
                  <div>
                    <h2 className="text-base font-bold text-slate-900">{selectedTrip.tripName}</h2>
                    <p className="text-xs text-slate-600">{selectedTrip.routeName}</p>
                  </div>
                  <div className="flex items-center gap-1 px-2 py-1 bg-emerald-100 rounded-full">
                    <div className="w-2 h-2 rounded-full bg-emerald-500 animate-pulse" />
                    <span className="text-xs font-bold text-emerald-800">LIVE</span>
                  </div>
                </div>

                <div className="grid grid-cols-3 gap-2 text-xs">
                  <div className="text-center py-1.5 bg-slate-50 rounded-lg">
                    <p className="font-bold text-slate-900">{selectedTrip.employees?.length || 0}</p>
                    <p className="text-slate-600">Total</p>
                  </div>
                  <div className="text-center py-1.5 bg-blue-50 rounded-lg">
                    <p className="font-bold text-blue-900">
                      {selectedTrip.employees?.filter(e => e.status === 'picked_up').length || 0}
                    </p>
                    <p className="text-blue-600">Picked</p>
                  </div>
                  <div className="text-center py-1.5 bg-green-50 rounded-lg">
                    <p className="font-bold text-green-900">
                      {selectedTrip.employees?.filter(e => e.status === 'dropped').length || 0}
                    </p>
                    <p className="text-green-600">Dropped</p>
                  </div>
                </div>
              </div>

              {/* Current Location */}
              <div className="bg-white border border-slate-200 rounded-xl p-3">
                <div className="flex items-center justify-between mb-2">
                  <p className="text-xs font-bold text-slate-900 uppercase tracking-wider">Driver Location</p>
                  <span className="px-2 py-0.5 bg-green-100 text-green-800 rounded-full text-[10px] font-bold">
                    LIVE
                  </span>
                </div>
                <p className="text-xs text-slate-900 mb-2 leading-tight">
                  {getAddress(`current-${selectedTrip._id}`, selectedTrip.latestLocation?.location?.coordinates)}
                </p>
                <div className="flex justify-between text-xs text-slate-600">
                  <div className="flex items-center gap-1">
                    <TrendingUp className="w-3 h-3" />
                    <span>{Math.round((selectedTrip.latestLocation?.location?.speed || 0) * 3.6)} km/h</span>
                  </div>
                  <div className="flex items-center gap-1">
                    <Clock className="w-3 h-3" />
                    <span>
                      {selectedTrip.latestLocation ? formatTime(selectedTrip.latestLocation.timestamp) : '--'}
                    </span>
                  </div>
                </div>
              </div>

              {/* Driver & Vehicle */}
              <div className="bg-white border border-slate-200 rounded-xl p-3">
                <p className="text-xs font-bold text-slate-900 uppercase tracking-wider mb-2">Driver & Vehicle</p>
                <div className="flex items-center gap-3">
                  <div className="w-10 h-10 bg-emerald-100 rounded-lg flex items-center justify-center flex-shrink-0">
                    <User className="w-5 h-5 text-emerald-600" />
                  </div>
                  <div className="flex-1 min-w-0">
                    <p className="text-sm font-bold text-slate-900 truncate">
                      {selectedTrip.assignedDriver?.user?.name || selectedTrip.assignedDriver?.driverId}
                    </p>
                    <p className="text-xs text-slate-600">
                      {selectedTrip.assignedVehicle?.vehicleNumber} • {selectedTrip.assignedVehicle?.model}
                    </p>
                  </div>
                  <button
                    onClick={() => {
                      const phone = selectedTrip.assignedDriver?.user?.phone;
                      if (phone) window.location.href = `tel:${phone}`;
                    }}
                    className="p-2 bg-emerald-50 rounded-lg"
                  >
                    <Phone className="w-4 h-4 text-emerald-600" />
                  </button>
                </div>
              </div>

              {/* Employees List */}
              <div className="bg-white border border-slate-200 rounded-xl p-3">
                <p className="text-xs font-bold text-slate-900 uppercase tracking-wider mb-2">
                  Employees ({selectedTrip.employees?.length || 0})
                </p>
                <div className="space-y-2 max-h-64 overflow-y-auto">
                  {selectedTrip.employees?.map((emp, idx) => (
                    <div
                      key={idx}
                      className="flex items-start gap-2 p-2 bg-slate-50 rounded-lg text-xs"
                    >
                      <div className="w-8 h-8 bg-white rounded-lg flex items-center justify-center border border-slate-200 flex-shrink-0">
                        {selectedTrip.tripType === 'login' ? (
                          <MapPin className="w-4 h-4 text-slate-600" />
                        ) : (
                          <Home className="w-4 h-4 text-slate-600" />
                        )}
                      </div>
                      <div className="flex-1 min-w-0">
                        <p className="font-bold text-slate-900 truncate">
                          {emp.employee?.user?.name || 'Employee'}
                        </p>
                        <p className="text-xs text-slate-600 truncate">
                          {selectedTrip.tripType === 'login'
                            ? emp.pickupLocation?.address
                            : emp.dropLocation?.address}
                        </p>
                        <div className="mt-1">
                          {getStatusBadge(emp.status)}
                        </div>
                      </div>
                      {emp.employee?.user?.phone && (
                        <button
                          onClick={() => window.location.href = `tel:${emp.employee.user.phone}`}
                          className="p-1.5 bg-rose-50 rounded-lg"
                        >
                          <Phone className="w-3.5 h-3.5 text-rose-600" />
                        </button>
                      )}
                    </div>
                  ))}
                </div>
              </div>

              {/* Emergency */}
              <div className="bg-rose-50 border border-rose-200 rounded-xl p-3">
                <div className="flex items-center gap-2 mb-2">
                  <AlertCircle className="w-4 h-4 text-rose-600" />
                  <p className="text-xs font-bold text-rose-900 uppercase tracking-wider">Emergency</p>
                </div>
                <button
                  onClick={() => {
                    const phone = selectedTrip.company?.contactDetails?.phone;
                    if (phone) window.location.href = `tel:${phone}`;
                  }}
                  className="w-full flex items-center justify-between p-2 bg-white rounded-lg"
                >
                  <div className="text-left">
                    <p className="text-xs font-bold text-slate-900">Company HR</p>
                    <p className="text-xs text-slate-600">
                      {selectedTrip.company?.contactDetails?.phone || 'Not available'}
                    </p>
                  </div>
                  <Phone className="w-4 h-4 text-rose-600" />
                </button>
              </div>
            </div>
          )}

          {!selectedTrip && effectiveView === 'detail' && (
            <div className="flex-1 flex items-center justify-center p-6">
              <div className="text-center">
                <Radio className="w-16 h-16 text-slate-400 mx-auto mb-4" />
                <h3 className="text-base font-bold text-slate-900 mb-2">No Trip Selected</h3>
                <p className="text-sm text-slate-600">Select a trip to view live tracking</p>
              </div>
            </div>
          )}
        </div>

        {/* Floating Map Button */}
        {selectedTrip && (
          <button
            onClick={() => setMapModal(true)}
            disabled={!selectedTrip.latestLocation}
            className={`fixed bottom-6 right-6 w-14 h-14 rounded-full shadow-xl flex items-center justify-center z-50 ${
              selectedTrip.latestLocation
                ? 'bg-emerald-600 text-white hover:bg-emerald-700'
                : 'bg-slate-200 text-slate-400 cursor-not-allowed'
            }`}
          >
            <Navigation className="w-6 h-6" />
          </button>
        )}

        {/* Map Modal */}
        {mapModal && selectedTrip?.latestLocation && (
          <div className="fixed inset-0 bg-black/70 z-[1000] flex items-center justify-center p-4">
            <div className="w-full h-[90vh] max-w-6xl bg-white rounded-2xl overflow-hidden shadow-2xl">
              <LiveTrackingMap
                trip={selectedTrip}
                currentLocation={selectedTrip.latestLocation}
                locationHistory={locationHistory}
                onClose={() => setMapModal(false)}
              />
            </div>
          </div>
        )}
      </div>
    </HRLayout>
  );
};

export default LiveTracking;