package com.arvirtualtryon.config;

import com.arvirtualtryon.services.ProductService;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.CommandLineRunner;
import org.springframework.context.annotation.Configuration;

@Configuration
public class StartupLoader implements CommandLineRunner {

    private final ProductService productService;

    @Autowired
    public StartupLoader(ProductService productService) {
        this.productService = productService;
    }

    @Override
    public void run(String... args) {
        String modelsDirectory = "src/main/resources/models";
        System.out.println("Parsing and updating model metadata...");
        productService.addOrUpdateProductsFromDirectory(modelsDirectory);
        System.out.println("Model metadata parsing and updating completed.");
    }
}
