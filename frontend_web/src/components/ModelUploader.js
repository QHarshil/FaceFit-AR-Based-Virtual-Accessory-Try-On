import React from 'react';

const ModelUploader = ({ productId }) => {
  const handleUpload = async (e) => {
    const file = e.target.files[0];
    const formData = new FormData();
    formData.append('file', file);

    try {
      await fetch(`http://localhost:8081/api/products/${productId}/model`, {
        method: 'POST',
        body: formData
      });
    } catch (error) {
      console.error('Upload failed:', error);
    }
  };

  return (
    <input
      type="file"
      accept=".glb,.gltf"
      onChange={handleUpload}
    />
  );
};

export default ModelUploader;