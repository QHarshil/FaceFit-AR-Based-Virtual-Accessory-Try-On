import React from 'react';

const ModelUploader = ({ productId }) => {
  const handleUpload = async (e) => {
    const file = e.target.files[0];
    const formData = new FormData();
    formData.append('file', file);

    try {
      const response = await fetch(
        `http://localhost:8081/api/products/${productId}/model`,
        {
          method: 'POST',
          body: formData,
        }
      );
      if (!response.ok) throw new Error('Upload failed');
      alert('Model uploaded successfully!');
    } catch (error) {
      console.error('Upload failed:', error);
      alert('Failed to upload the model');
    }
  };

  return (
    <input
      type="file"
      accept=".glb,.gltf"
      onChange={handleUpload}
      className="block w-full text-sm text-gray-900 border border-gray-300 rounded-lg cursor-pointer bg-gray-50 focus:outline-none"
    />
  );
};

export default ModelUploader;
