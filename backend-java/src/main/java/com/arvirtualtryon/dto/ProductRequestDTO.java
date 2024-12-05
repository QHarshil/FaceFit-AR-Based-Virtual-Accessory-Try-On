package com.arvirtualtryon.dtos;

import com.arvirtualtryon.models.ProductCategory;

import java.util.List;

public class ProductRequestDTO {
    private String name;
    private ProductCategory category;
    private String modelUrl;
    private List<String> textureUrls;
    private String binUrl;

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

    public List<String> getTextureUrls() {
        return textureUrls;
    }

    public void setTextureUrls(List<String> textureUrls) {
        this.textureUrls = textureUrls;
    }

    public String getBinUrl() {
        return binUrl;
    }

    public void setBinUrl(String binUrl) {
        this.binUrl = binUrl;
    }
}
