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

        for (File categoryDir : baseDir.listFiles(File::isDirectory)) {
            String categoryName = categoryDir.getName();
            Category category = productService.findOrCreateCategory(categoryName);

            for (File modelDir : categoryDir.listFiles(File::isDirectory)) {
                String modelName = modelDir.getName();

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

                ProductRequestDTO productRequest = new ProductRequestDTO();
                productRequest.setName(modelName);
                productRequest.setCategory(category.getName());
                productRequest.setModelUrl(modelUrl);
                productRequest.setBinUrl(binUrl);
                productRequest.setTextureUrls(textureUrls);

                try {
                    productService.createProduct(productRequest);
                } catch (Exception e) {
                    System.out.println("Failed to save product: " + modelName + " - " + e.getMessage());
                }
            }
        }
    }
}
