package com.arvirtualtryon.utils;

import com.arvirtualtryon.dtos.ProductRequestDTO;
import com.arvirtualtryon.services.ProductService;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.stereotype.Component;
import com.arvirtualtryon.models.Category;

import java.io.File;
import java.util.ArrayList;
import java.util.List;

@Component
public class ModelMetadataParser {

    private final ProductService productService;

    @Autowired
    public ModelMetadataParser(ProductService productService) {
        this.productService = productService;
    }

    public void parseAndSaveModels(String basePath) {
        File baseDir = new File(basePath);
        if (!baseDir.exists() || !baseDir.isDirectory()) {
            throw new IllegalArgumentException("Invalid base path: " + basePath);
        }

        // Iterate over category directories (e.g., glasses, hats)
        for (File categoryDir : baseDir.listFiles(File::isDirectory)) {
            String categoryName = categoryDir.getName(); // e.g., "glasses" or "hats"
            Category category = productService.findOrCreateCategory(categoryName);

            // Iterate over files directly in the category directory
            for (File modelFile : categoryDir.listFiles()) {
                if (modelFile.isFile() && (modelFile.getName().endsWith(".gltf") || modelFile.getName().endsWith(".glb"))) {
                    String modelName = modelFile.getName().split("\\.")[0]; // Use the filename (without extension) as the model name
                    String modelUrl = modelFile.getPath().replace("\\", "/");

                    ProductRequestDTO productRequest = new ProductRequestDTO();
                    productRequest.setName(modelName);
                    productRequest.setCategory(category.getName());
                    productRequest.setModelUrl(modelUrl);
                    productRequest.setBinUrl(null); // No .bin expected
                    productRequest.setTextureUrls(new ArrayList<>()); // No textures in this structure

                    try {
                        productService.createProduct(productRequest);
                    } catch (Exception e) {
                        System.out.println("Failed to save product: " + modelName + " - " + e.getMessage());
                    }
                }
            }
        }
    }
}
