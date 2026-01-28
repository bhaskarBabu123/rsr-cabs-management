// src/context/SocketContext.jsx
import React, { createContext, useContext, useEffect, useRef, useState } from 'react';
import { io } from 'socket.io-client';

const SocketContext = createContext(null);

export const useSocket = () => {
  const context = useContext(SocketContext);
  if (!context) {
    return {
      socket: null,
      isConnected: false,
      sendLocationUpdate: () => {},
      subscribeToLocationUpdates: () => {},
      subscribeToTripUpdates: () => {},
      sendTripStatusUpdate: () => {},
      sendEmployeeStatusUpdate: () => {},
      sendMessage: () => {},
      subscribeToMessages: () => {},
      sendEmergencyAlert: () => {},
      joinTripRoom: () => {},
      leaveTripRoom: () => {}
    };
  }
  return context;
};

export const SocketProvider = ({ children }) => {
  const [socket, setSocket] = useState(null);
  const [isConnected, setIsConnected] = useState(false);
  const socketRef = useRef(null);

  useEffect(() => {
    const token = localStorage.getItem('accessToken');
    const userStr = localStorage.getItem('user');
    
    if (!token || !userStr) {
      return;
    }

    const user = JSON.parse(userStr);

    // Initialize socket connection
    const SOCKET_URL = process.env.REACT_APP_SOCKET_URL || 'https://stall-bookings-backend.onrender.com';
    
    const newSocket = io(SOCKET_URL, {
      auth: {
        token: token,
        userId: user._id,
        role: user.role
      },
      transports: ['websocket', 'polling'],
      reconnection: true,
      reconnectionAttempts: 5,
      reconnectionDelay: 1000,
      reconnectionDelayMax: 5000,
      timeout: 20000
    });

    socketRef.current = newSocket;

    // Connection event handlers
    newSocket.on('connect', () => {
      console.log('Socket connected:', newSocket.id);
      setIsConnected(true);
      
      // Join user's room based on role
      if (user.role === 'driver') {
        newSocket.emit('driver:join', { driverId: user._id });
      } else if (user.role === 'employee') {
        newSocket.emit('employee:join', { employeeId: user._id });
      } else if (user.role === 'rsr_admin' || user.role === 'office_hr') {
        newSocket.emit('admin:join', { adminId: user._id });
      }
    });

    newSocket.on('disconnect', (reason) => {
      console.log('Socket disconnected:', reason);
      setIsConnected(false);
    });

    newSocket.on('connect_error', (error) => {
      console.error('Socket connection error:', error);
      setIsConnected(false);
    });

    newSocket.on('error', (error) => {
      console.error('Socket error:', error);
    });

    setSocket(newSocket);

    // Cleanup on unmount
    return () => {
      if (newSocket) {
        newSocket.disconnect();
      }
    };
  }, []);

  // Send location update
  const sendLocationUpdate = (tripId, location) => {
    if (socket && isConnected) {
      socket.emit('location:update', {
        tripId,
        location,
        timestamp: new Date().toISOString()
      });
    }
  };

  // Subscribe to location updates
  const subscribeToLocationUpdates = (tripId, callback) => {
    if (socket) {
      socket.on(`location:update:${tripId}`, callback);
      
      // Cleanup function
      return () => {
        socket.off(`location:update:${tripId}`, callback);
      };
    }
  };

  // Subscribe to trip updates
  const subscribeToTripUpdates = (tripId, callback) => {
    if (socket) {
      socket.on(`trip:update:${tripId}`, callback);
      
      return () => {
        socket.off(`trip:update:${tripId}`, callback);
      };
    }
  };

  // Send trip status update
  const sendTripStatusUpdate = (tripId, status, data = {}) => {
    if (socket && isConnected) {
      socket.emit('trip:status', {
        tripId,
        status,
        ...data,
        timestamp: new Date().toISOString()
      });
    }
  };

  // Send employee status update
  const sendEmployeeStatusUpdate = (tripId, employeeId, status) => {
    if (socket && isConnected) {
      socket.emit('employee:status', {
        tripId,
        employeeId,
        status,
        timestamp: new Date().toISOString()
      });
    }
  };

  // Send message
  const sendMessage = (tripId, message) => {
    if (socket && isConnected) {
      const userStr = localStorage.getItem('user');
      const user = userStr ? JSON.parse(userStr) : {};
      
      socket.emit('message:send', {
        tripId,
        message,
        senderId: user._id,
        senderName: user.name,
        timestamp: new Date().toISOString()
      });
    }
  };

  // Subscribe to messages
  const subscribeToMessages = (tripId, callback) => {
    if (socket) {
      socket.on(`message:${tripId}`, callback);
      
      return () => {
        socket.off(`message:${tripId}`, callback);
      };
    }
  };

  // Send SOS/Emergency alert
  const sendEmergencyAlert = (tripId, location, message) => {
    if (socket && isConnected) {
      const userStr = localStorage.getItem('user');
      const user = userStr ? JSON.parse(userStr) : {};
      
      socket.emit('emergency:alert', {
        tripId,
        driverId: user._id,
        driverName: user.name,
        location,
        message,
        timestamp: new Date().toISOString()
      });
    }
  };

  // Join trip room
  const joinTripRoom = (tripId) => {
    if (socket && isConnected) {
      socket.emit('trip:join', { tripId });
    }
  };

  // Leave trip room
  const leaveTripRoom = (tripId) => {
    if (socket && isConnected) {
      socket.emit('trip:leave', { tripId });
    }
  };

  const value = {
    socket,
    isConnected,
    sendLocationUpdate,
    subscribeToLocationUpdates,
    subscribeToTripUpdates,
    sendTripStatusUpdate,
    sendEmployeeStatusUpdate,
    sendMessage,
    subscribeToMessages,
    sendEmergencyAlert,
    joinTripRoom,
    leaveTripRoom
  };

  return (
    <SocketContext.Provider value={value}>
      {children}
    </SocketContext.Provider>
  );
};

export default SocketContext;