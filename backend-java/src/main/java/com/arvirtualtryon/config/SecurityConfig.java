package com.arvirtualtryon.config;

import org.springframework.context.annotation.Bean;
import org.springframework.context.annotation.Configuration;
import org.springframework.security.config.annotation.web.builders.HttpSecurity;
import org.springframework.http.HttpMethod;
import org.springframework.security.crypto.bcrypt.BCryptPasswordEncoder;
import org.springframework.security.web.SecurityFilterChain;

@Configuration
public class SecurityConfig {

    @Bean
    public SecurityFilterChain securityFilterChain(HttpSecurity http) throws Exception {
        http
            .csrf(csrf -> csrf.disable()) // Disable CSRF for simplicity
            .authorizeHttpRequests(auth -> auth
                .requestMatchers("/api/users/register", "/api/users/login").permitAll() // Allow public access to these
                .requestMatchers(HttpMethod.GET, "/api/products/**").permitAll() // Allow all GET requests for /api/products
                .anyRequest().authenticated() // Protect all other endpoints
            )
            .httpBasic(httpBasic -> httpBasic.disable()) // Disable HTTP Basic authentication
            .formLogin(form -> form.disable()); // Disable default login form
        return http.build();
    }

    @Bean
    public BCryptPasswordEncoder passwordEncoder() {
        return new BCryptPasswordEncoder();
    }
}
