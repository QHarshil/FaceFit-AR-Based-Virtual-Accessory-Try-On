package com.arvirtualtryon.controllers;

import com.arvirtualtryon.dto.LoginRequest;
import com.arvirtualtryon.models.User;
import com.arvirtualtryon.services.IUserService;
import com.arvirtualtryon.utils.JwtUtil;

import java.util.HashMap;
import java.util.Map;

import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.http.HttpStatus;
import org.springframework.http.ResponseEntity;
import org.springframework.web.bind.annotation.*;

import jakarta.validation.Valid;

@RestController
@RequestMapping("/api/users")
@CrossOrigin(origins = "http://localhost:3000")
public class UserController {

    private final IUserService userService;
    private final JwtUtil jwtUtil;

    @Autowired
    public UserController(IUserService userService, JwtUtil jwtUtil) {
        this.userService = userService;
        this.jwtUtil = jwtUtil;
    }

    @PostMapping("/register")
    public ResponseEntity<?> registerUser(@Valid @RequestBody User user) {
        try {
            User createdUser = userService.createUser(user);
            return ResponseEntity.status(HttpStatus.CREATED).body(createdUser);
        } catch (IllegalArgumentException e) {
            Map<String, String> errorResponse = new HashMap<>();
            errorResponse.put("error", e.getMessage());
            return ResponseEntity.badRequest().body(errorResponse);
        }
    }

    @PostMapping("/login")
    public ResponseEntity<?> loginUser(@Valid @RequestBody LoginRequest loginRequest) {
        Map<String, Object> response = new HashMap<>();
        try {
            User user = userService.getUserByEmail(loginRequest.getEmail());
            if (user != null) {
                System.out.println("User found: " + user.getEmail());
                if (userService.verifyPassword(loginRequest.getPassword(), user.getPassword())) {
                    String token = jwtUtil.generateToken(user.getEmail());
                    response.put("message", "Login successful");
                    response.put("token", token);
                    response.put("user", user);
                    return ResponseEntity.ok(response);
                } else {
                    response.put("error", "Invalid email or password");
                    return ResponseEntity.status(HttpStatus.UNAUTHORIZED).body(response);
                }
            } else {
                response.put("error", "User not found");
                return ResponseEntity.status(HttpStatus.UNAUTHORIZED).body(response);
            }
        } catch (Exception e) {
            e.printStackTrace();
            response.put("error", "Login failed: " + e.getMessage());
            return ResponseEntity.status(HttpStatus.INTERNAL_SERVER_ERROR).body(response);
        }
    }
}
