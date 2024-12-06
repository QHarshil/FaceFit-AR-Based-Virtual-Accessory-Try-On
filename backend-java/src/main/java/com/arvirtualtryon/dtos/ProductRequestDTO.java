package com.arvirtualtryon.dtos;

import java.util.List;

public class ProductRequestDTO {
    private String name;
    private String category; // Updated to dynamic category handling
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

    public String getCategory() {
        return category;
    }

    public void setCategory(String category) {
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
