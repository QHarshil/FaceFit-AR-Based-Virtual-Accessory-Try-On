package com.arvirtualtryon.config;

import com.arvirtualtryon.utils.ModelMetadataParser;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.CommandLineRunner;
import org.springframework.context.annotation.Configuration;

/**
 * Configuration class to load initial data during application startup.
 */
@Configuration
public class StartupLoader implements CommandLineRunner {

    private final ModelMetadataParser modelMetadataParser;

    /**
     * Constructor to inject ModelMetadataParser dependency.
     *
     * @param modelMetadataParser Utility for parsing and saving model metadata.
     */
    @Autowired
    public StartupLoader(ModelMetadataParser modelMetadataParser) {
        this.modelMetadataParser = modelMetadataParser;
    }

    /**
     * Runs on application startup to parse and save model metadata.
     *
     * @param args Command-line arguments.
     * @throws Exception if an error occurs during processing.
     */
    @Override
    public void run(String... args) throws Exception {
        System.out.println("Starting model metadata parsing...");
        String basePath = "src/main/resources/models"; // Adjust path if necessary
        modelMetadataParser.parseAndSaveModels(basePath);
        System.out.println("Model metadata parsing completed.");
    }
}
