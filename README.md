# GEE LULC Multi-year Crop Classification  
A comprehensive land use and crop classification workflow that utilizes Machine Learning for multi-year analysis using satellite imagery from both Sentinel-2 and Landsat.

# Overview
This workflow implements a Random Forest classifier trained on a single year's ground data to perform land use and crop classification across two decades of satellite data. 
The model leverages seasonal median composites and multiple vegetation indices to achieve robust classification performance.

# Input Data
### Sentinel-2: 
Surface reflectance data
### Landsat Series: 
Surface reflectance data (Landsat 5, 7, 8, 9)
### Vegetation Indices
NDVI, NDWI, EVI2
### Spectral Bands
Surface reflectance values from visible, NIR, and SWIR regions
### Ground Data
Single year of training data for model training collected in Morocco
Applied to classification across two decades (2000-2023)

# STEPS
## 1. Data Preprocessing
Cloud masking and atmospheric correction
Seasonal compositing using 45-day windows
Calculation of vegetation indices (NDVI, NDWI, EVI)
## 2. Feature Compositing
Median value calculation per season
Combination of spectral bands and indices
Multi-sensor data harmonization
## 3. Model Training
Random Forest classifier implementation
Training on single-year ground reference data
Hyperparameter optimization
## 4. Classification
Application to multi-year satellite data
Annual land use/crop classification
Output generation (Rasters) for analysis

## Technical Requirements
Google Earth Engine account

## Usage
This workflow is designed for researchers and practitioners in remote sensing, agriculture, and environmental science who need to perform large-scale land use classification with limited ground truth data.

## Note
The unique aspect of this workflow is its ability to leverage a single year's training data to perform classification across multiple years, making it particularly valuable for historical analysis where ground truth data may be limited.

## Citation
The research paper related to this work will be available soon


