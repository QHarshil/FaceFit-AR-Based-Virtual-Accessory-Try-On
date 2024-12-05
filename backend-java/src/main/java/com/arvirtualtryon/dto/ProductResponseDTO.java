package com.arvirtualtryon.dtos;

import com.arvirtualtryon.models.ProductCategory;

/**
 * Data Transfer Object for sending Product data in API responses.
 */
public class ProductResponseDTO {

    private Long id;
    private String name;
    private ProductCategory category;
    private String modelUrl; // Fully resolved URL for 3D model
    private String textureUrl; // Fully resolved URL for texture file

    // Getters and Setters

    /**
     * Get the ID of the product.
     * @return ID of the product.
     */
    public Long getId() {
        return id;
    }

    /**
     * Set the ID of the product.
     * @param id ID to be assigned.
     */
    public void setId(Long id) {
        this.id = id;
    }

    /**
     * Get the name of the product.
     * @return Product name.
     */
    public String getName() {
        return name;
    }

    /**
     * Set the name of the product.
     * @param name Name to be assigned.
     */
    public void setName(String name) {
        this.name = name;
    }

    /**
     * Get the category of the product.
     * @return Product category.
     */
    public ProductCategory getCategory() {
        return category;
    }

    /**
     * Set the category of the product.
     * @param category Category to be assigned.
     */
    public void setCategory(ProductCategory category) {
        this.category = category;
    }

    /**
     * Get the URL for the 3D model.
     * @return Fully resolved model URL.
     */
    public String getModelUrl() {
        return modelUrl;
    }

    /**
     * Set the URL for the 3D model.
     * @param modelUrl Fully resolved URL to the model.
     */
    public void setModelUrl(String modelUrl) {
        this.modelUrl = modelUrl;
    }

    /**
     * Get the URL for the texture file.
     * @return Fully resolved texture URL.
     */
    public String getTextureUrl() {
        return textureUrl;
    }

    /**
     * Set the URL for the texture file.
     * @param textureUrl Fully resolved URL to the texture file.
     */
    public void setTextureUrl(String textureUrl) {
        this.textureUrl = textureUrl;
    }
}
