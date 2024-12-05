package com.arvirtualtryon.utils;

import com.arvirtualtryon.models.Product;
import com.arvirtualtryon.models.ProductCategory;
import com.arvirtualtryon.services.ProductService;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.stereotype.Component;

import java.io.File;
import java.util.ArrayList;
import java.util.List;

/**
 * Utility class for parsing and saving model metadata from the resources folder.
 * Extracts model, bin, and texture file paths to populate the database.
 */
@Component
public class ModelMetadataParser {

    private final ProductService productService;

    /**
     * Constructor to inject the ProductService dependency.
     *
     * @param productService Service for handling product-related operations.
     */
    @Autowired
    public ModelMetadataParser(ProductService productService) {
        this.productService = productService;
    }

    /**
     * Parses the model metadata from the given base directory and saves it to the database.
     *
     * @param basePath The base directory containing model folders (e.g., "src/main/resources/models").
     */
    public void parseAndSaveModels(String basePath) {
        File baseDir = new File(basePath);
        if (!baseDir.exists() || !baseDir.isDirectory()) {
            throw new IllegalArgumentException("Invalid base path: " + basePath);
        }

        for (File categoryDir : baseDir.listFiles(File::isDirectory)) {
            String categoryName = categoryDir.getName().toUpperCase();
            ProductCategory category;

            try {
                category = ProductCategory.valueOf(categoryName);
            } catch (IllegalArgumentException e) {
                System.out.println("Skipping unknown category: " + categoryName);
                continue;
            }

            for (File modelDir : categoryDir.listFiles(File::isDirectory)) {
                String modelName = modelDir.getName();

                // Extract file paths for .gltf, .bin, and textures
                String modelUrl = null;
                String binUrl = null;
                List<String> textureUrls = new ArrayList<>();
                for (File file : modelDir.listFiles()) {
                    if (file.isFile()) {
                        if (file.getName().endsWith(".gltf")) {
                            modelUrl = file.getPath().replace("\\", "/");
                        } else if (file.getName().endsWith(".bin")) {
                            binUrl = file.getPath().replace("\\", "/");
                        }
                    } else if (file.isDirectory() && file.getName().equalsIgnoreCase("textures")) {
                        for (File texture : file.listFiles()) {
                            textureUrls.add(texture.getPath().replace("\\", "/"));
                        }
                    }
                }

                if (modelUrl == null) {
                    System.out.println("Skipping model folder without .gltf file: " + modelName);
                    continue;
                }

                // Save product to the database
                Product product = new Product();
                product.setName(modelName);
                product.setCategory(category);
                product.setModelUrl(modelUrl);
                product.setBinUrl(binUrl);
                product.setTextureUrls(textureUrls);

                try {
                    productService.createProduct(product);
                } catch (Exception e) {
                    System.out.println("Error saving product " + modelName + ": " + e.getMessage());
                }
            }
        }
    }
}
