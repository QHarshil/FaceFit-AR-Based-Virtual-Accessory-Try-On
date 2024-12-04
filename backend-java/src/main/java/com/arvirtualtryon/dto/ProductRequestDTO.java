package com.arvirtualtryon.dtos;

import com.arvirtualtryon.models.ProductCategory;
import jakarta.validation.constraints.NotBlank;
import jakarta.validation.constraints.NotNull;
import jakarta.validation.constraints.Size;

/**
 * Data Transfer Object for creating or updating Product information.
 * Helps decouple the API layer from the database model.
 */
public class ProductRequestDTO {

    @NotBlank
    @Size(max = 100, message = "Product name must not exceed 100 characters.")
    private String name;

    @NotNull(message = "Category is required.")
    private ProductCategory category;

    @NotBlank(message = "Model URL cannot be blank.")
    private String modelUrl;

    private String textureUrl;

    // Getters and Setters
    public String getName() {
        return name;
    }

    public void setName(String name) {
        this.name = name;
    }

    public ProductCategory getCategory() {
        return category;
    }

    public void setCategory(ProductCategory category) {
        this.category = category;
    }

    public String getModelUrl() {
        return modelUrl;
    }

    public void setModelUrl(String modelUrl) {
        this.modelUrl = modelUrl;
    }

    public String getTextureUrl() {
        return textureUrl;
    }

    public void setTextureUrl(String textureUrl) {
        this.textureUrl = textureUrl;
    }
}
