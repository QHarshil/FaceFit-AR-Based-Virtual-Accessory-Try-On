import React from 'react';
import Navbar from './Navbar';
import FaceMeshComponent from '../components/FaceMeshComponent';

const VirtualTryOn = () => {
  return (
    <div>
      {/* <Navbar /> */}
      <div style={{ marginTop: '64px' }}> {/* Adjust margin to avoid overlap with Navbar */}
        <FaceMeshComponent />
      </div>
    </div>
  );
};

export default VirtualTryOn;