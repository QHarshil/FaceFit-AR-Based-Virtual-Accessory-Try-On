package com.arvirtualtryon.config;

import com.arvirtualtryon.models.Product;
import com.arvirtualtryon.models.ProductCategory;
import com.arvirtualtryon.repositories.ProductRepository;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.CommandLineRunner;
import org.springframework.stereotype.Component;

import java.io.File;
import java.util.Arrays;
import java.util.List;

/**
 * Component to initialize the database with model metadata during application startup.
 */
@Component
public class DataInitializer implements CommandLineRunner {

    private final ProductRepository productRepository;
    private static final String BASE_PATH = "src/main/resources/models";

    @Autowired
    public DataInitializer(ProductRepository productRepository) {
        this.productRepository = productRepository;
    }

    @Override
    public void run(String... args) {
        if (productRepository.count() > 0) {
            System.out.println("Database already initialized. Skipping data initialization.");
            return;
        }

        System.out.println("Initializing database with model metadata...");

        // Load glasses metadata
        loadProductData("glasses", ProductCategory.GLASSES);

        // Load hats metadata
        loadProductData("hats", ProductCategory.HATS);

        System.out.println("Database initialization complete.");
    }

    /**
     * Load product data from a specified directory and save it to the database.
     *
     * @param directoryName The directory name (e.g., "glasses", "hats").
     * @param category      The product category.
     */
    private void loadProductData(String directoryName, ProductCategory category) {
        File categoryDir = new File(BASE_PATH + "/" + directoryName);

        if (!categoryDir.exists() || !categoryDir.isDirectory()) {
            System.err.println("Directory not found: " + categoryDir.getPath());
            return;
        }

        File[] productDirs = categoryDir.listFiles(File::isDirectory);
        if (productDirs == null) return;

        for (File productDir : productDirs) {
            String modelUrl = null;
            String binFileUrl = null;
            String name = productDir.getName();
            List<String> textures = null;

            File[] files = productDir.listFiles();
            if (files == null) continue;

            for (File file : files) {
                if (file.getName().endsWith(".gltf")) {
                    modelUrl = directoryName + "/" + productDir.getName() + "/" + file.getName();
                } else if (file.getName().endsWith(".bin")) {
                    binFileUrl = directoryName + "/" + productDir.getName() + "/" + file.getName();
                } else if (file.isDirectory() && file.getName().equalsIgnoreCase("textures")) {
                    textures = Arrays.stream(file.listFiles())
                            .map(texture -> directoryName + "/" + productDir.getName() + "/textures/" + texture.getName())
                            .toList();
                }
            }

            if (modelUrl != null) {
                Product product = new Product();
                product.setName(name);
                product.setCategory(category);
                product.setModelUrl(modelUrl);
                product.setBinFileUrl(binFileUrl);
                product.setTextureUrls(textures);

                productRepository.save(product);
                System.out.println("Saved product: " + name);
            }
        }
    }
}
