package com.arvirtualtryon.config;

import com.arvirtualtryon.utils.ModelMetadataParser;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.CommandLineRunner;
import org.springframework.context.annotation.Configuration;

@Configuration
public class StartupLoader implements CommandLineRunner {

    private final ModelMetadataParser modelMetadataParser;

    @Autowired
    public StartupLoader(ModelMetadataParser modelMetadataParser) {
        this.modelMetadataParser = modelMetadataParser;
    }

    @Override
    public void run(String... args) {
        System.out.println("Parsing and saving model metadata...");
        String basePath = "src/main/resources/models";
        modelMetadataParser.parseAndSaveModels(basePath);
        System.out.println("Model metadata parsing completed.");
    }
}
