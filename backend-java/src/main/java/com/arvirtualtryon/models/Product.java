package com.arvirtualtryon.models;

import jakarta.persistence.*;
import jakarta.validation.constraints.NotBlank;
import jakarta.validation.constraints.Size;
import org.springframework.data.annotation.CreatedDate;
import org.springframework.data.annotation.LastModifiedDate;

import java.time.LocalDateTime;
import java.util.List;

/**
 * Represents a product in the AR Virtual Try-On application.
 */
@Entity
@Table(name = "products")
public class Product {

    @Id
    @GeneratedValue(strategy = GenerationType.IDENTITY)
    private Long id;

    @NotBlank
    @Size(max = 100, message = "Product name must not exceed 100 characters.")
    @Column(nullable = false)
    private String name;

    @Enumerated(EnumType.STRING)
    @Column(nullable = false)
    private ProductCategory category;

    @NotBlank
    @Column(nullable = false, unique = true)
    private String modelUrl; // Path to the GLTF file

    @ElementCollection
    @CollectionTable(name = "product_textures", joinColumns = @JoinColumn(name = "product_id"))
    @Column(name = "texture_url")
    private List<String> textureUrls; // Paths to texture files

    @Column(nullable = true)
    private String binUrl; // Optional path to the .bin file

    @ElementCollection
    @CollectionTable(name = "product_tags", joinColumns = @JoinColumn(name = "product_id"))
    @Column(name = "tag")
    private List<String> tags; // Tags for filtering/search

    @Column(nullable = true)
    private String dimensions; // Dimensions metadata, e.g., "width: 10, height: 15"

    @CreatedDate
    @Column(nullable = false, updatable = false)
    private LocalDateTime createdAt;

    @LastModifiedDate
    @Column(nullable = false)
    private LocalDateTime updatedAt;

    // Getters and Setters
    public Long getId() {
        return id;
    }

    public void setId(Long id) {
        this.id = id;
    }

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

    public List<String> getTags() {
        return tags;
    }

    public void setTags(List<String> tags) {
        this.tags = tags;
    }

    public String getDimensions() {
        return dimensions;
    }

    public void setDimensions(String dimensions) {
        this.dimensions = dimensions;
    }

    public LocalDateTime getCreatedAt() {
        return createdAt;
    }

    public void setCreatedAt(LocalDateTime createdAt) {
        this.createdAt = createdAt;
    }

    public LocalDateTime getUpdatedAt() {
        return updatedAt;
    }

    public void setUpdatedAt(LocalDateTime updatedAt) {
        this.updatedAt = updatedAt;
    }
}
